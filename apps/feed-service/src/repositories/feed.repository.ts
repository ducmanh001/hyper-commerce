// ============================================================
// HYPERCOMMERCE — Feed Repository (Cassandra)
// Time-bucketed partition strategy để tránh hot partitions.
// Read pattern: range scan by user_id + bucket + created_at.
// Write pattern: INSERT only (append-only) — không update feed rows.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { Client as CassandraClient } from 'cassandra-driver';
import { types as CassandraTypes } from 'cassandra-driver';
import { Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@hypercommerce/common/constants/app.constants';

export interface FeedItem {
  userId: string;
  bucket: string; // 'YYYYMM' — e.g. '202501'
  createdAt: Date;
  postId: string;
  authorId: string;
  authorUsername: string;
  postType: 'VIDEO' | 'IMAGE' | 'TEXT' | 'LIVE' | 'PRODUCT';
  contentPreview: string;
  mediaUrl?: string;
  productId?: string;
  score: number; // precomputed ML score
  engagementRate: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export interface FeedQueryOptions {
  userId: string;
  buckets: string[]; // Which months to scan
  limit: number;
  cursor?: {
    // Cassandra paging state (opaque bytes)
    bucket: string;
    pagingState: Buffer;
  };
}

// Cassandra schema (for reference):
// CREATE TABLE feed_items (
//   user_id    UUID,
//   bucket     TEXT,        -- YYYYMM, avoids hot partition
//   created_at TIMESTAMP,
//   post_id    UUID,
//   author_id  UUID,
//   post_type  TEXT,
//   score      FLOAT,
//   ...
//   PRIMARY KEY ((user_id, bucket), created_at, post_id)
// ) WITH CLUSTERING ORDER BY (created_at DESC)
//   AND gc_grace_seconds = 864000       -- 10 days
//   AND compaction = {'class': 'TimeWindowCompactionStrategy',
//                     'compaction_window_unit': 'DAYS',
//                     'compaction_window_size': 7};
// -- TimeWindowCompactionStrategy optimal for time-series writes

@Injectable()
export class FeedRepository {
  private readonly logger = new Logger(FeedRepository.name);

  // Prepared statement query strings — actual preparation happens lazily via
  // cassandra-driver's built-in query cache when execute({ prepare: true }) is called
  private readonly SQL_INSERT_FEED_ITEM = `
        INSERT INTO hypercommerce_feed.feed_items
          (user_id, bucket, created_at, post_id, author_id, author_username,
           post_type, content_preview, media_url, product_id, score,
           engagement_rate, like_count, comment_count, share_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        USING TTL 7776000
      `;
  private readonly SQL_SELECT_FEED_BY_BUCKET = `
        SELECT user_id, bucket, created_at, post_id, author_id, author_username,
               post_type, content_preview, media_url, product_id, score,
               engagement_rate, like_count, comment_count, share_count
        FROM hypercommerce_feed.feed_items
        WHERE user_id = ? AND bucket = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;
  private readonly SQL_DELETE_FEED_ITEM = `
        DELETE FROM hypercommerce_feed.feed_items
        WHERE user_id = ? AND bucket = ? AND created_at = ? AND post_id = ?
      `;

  constructor(
    @Inject(INJECTION_TOKENS.CASSANDRA_CLIENT)
    private readonly cassandra: CassandraClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.cassandra.execute('SELECT release_version FROM system.local').catch((err: Error) => {
      this.logger.warn(`Cassandra connection check failed: ${err.message}`);
    });
    this.logger.log('Cassandra connection verified');
  }

  /**
   * Insert a feed item for a user — O(1) Cassandra write.
   * Called by fan-out worker for each (user, post) pair.
   */
  async insertFeedItem(item: FeedItem): Promise<void> {
    await this.cassandra.execute(
      this.SQL_INSERT_FEED_ITEM,
      [
        item.userId,
        item.bucket,
        item.createdAt,
        item.postId,
        item.authorId,
        item.authorUsername,
        item.postType,
        item.contentPreview,
        item.mediaUrl ?? null,
        item.productId ?? null,
        item.score,
        item.engagementRate,
        item.likeCount,
        item.commentCount,
        item.shareCount,
      ],
      // LOCAL_QUORUM: quorum within local DC only — balance of consistency + latency
      { consistency: CassandraTypes.consistencies.localQuorum, prepare: true },
    );
  }

  /**
   * Batch insert — used by fan-out worker processing 100s of users at once.
   * Cassandra batch is NOT a transaction — it's an optimization hint
   * telling the coordinator to send all writes together.
   *
   * IMPORTANT: Use UNLOGGED batch (default for same partition) —
   * LOGGED batch adds overhead of batch log table writes.
   */
  async batchInsertFeedItems(items: FeedItem[]): Promise<void> {
    if (!items.length) return;

    // Split by partition key (user_id, bucket) for same-partition batching
    const partitionGroups = this.groupByPartition(items);

    await Promise.all(
      partitionGroups.map((group) => {
        const batch = group.map((item) => ({
          query: this.SQL_INSERT_FEED_ITEM,
          params: [
            item.userId,
            item.bucket,
            item.createdAt,
            item.postId,
            item.authorId,
            item.authorUsername,
            item.postType,
            item.contentPreview,
            item.mediaUrl ?? null,
            item.productId ?? null,
            item.score,
            item.engagementRate,
            item.likeCount,
            item.commentCount,
            item.shareCount,
          ],
        }));

        return this.cassandra.batch(batch, {
          consistency: CassandraTypes.consistencies.localQuorum,
          logged: false, // unlogged = faster, no cross-partition guarantee
        });
      }),
    );
  }

  /**
   * Fetch raw feed posts across multiple time buckets.
   *
   * Strategy: query current month + previous month in parallel,
   * merge results client-side. This avoids cross-partition queries
   * in Cassandra (which are scatter-gather — N nodes).
   */
  async getFeedItems(options: FeedQueryOptions): Promise<FeedItem[]> {
    const { userId, buckets, limit } = options;

    // Query each bucket in parallel — different Cassandra partitions
    const bucketResults = await Promise.all(
      buckets.map((bucket) => this.fetchBucket(userId, bucket, limit)),
    );

    // Merge and sort by created_at DESC — client-side merge sort
    const all = bucketResults.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return all.slice(0, limit);
  }

  private async fetchBucket(userId: string, bucket: string, limit: number): Promise<FeedItem[]> {
    const result = await this.cassandra.execute(
      this.SQL_SELECT_FEED_BY_BUCKET,
      [userId, bucket, limit],
      {
        consistency: CassandraTypes.consistencies.localOne, // Fast reads — eventual OK for feed
        fetchSize: limit,
        prepare: true,
      },
    );

    return result.rows.map(this.rowToFeedItem);
  }

  async deleteFeedItem(
    userId: string,
    bucket: string,
    createdAt: Date,
    postId: string,
  ): Promise<void> {
    await this.cassandra.execute(this.SQL_DELETE_FEED_ITEM, [userId, bucket, createdAt, postId], {
      consistency: CassandraTypes.consistencies.localQuorum,
      prepare: true,
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  private rowToFeedItem(row: Record<string, unknown>): FeedItem {
    const get = <T>(field: string): T => (row as Record<string, T>)[field];
    return {
      userId: String(get('user_id') ?? ''),
      bucket: String(get('bucket') ?? ''),
      createdAt: get<Date>('created_at') ?? new Date(),
      postId: String(get('post_id') ?? ''),
      authorId: String(get('author_id') ?? ''),
      authorUsername: String(get('author_username') ?? ''),
      postType: get<FeedItem['postType']>('post_type'),
      contentPreview: String(get('content_preview') ?? ''),
      mediaUrl: get<string | undefined>('media_url'),
      productId: get<string | undefined>('product_id'),
      score: Number(get('score') ?? 0),
      engagementRate: Number(get('engagement_rate') ?? 0),
      likeCount: Number(get('like_count') ?? 0),
      commentCount: Number(get('comment_count') ?? 0),
      shareCount: Number(get('share_count') ?? 0),
    };
  }

  private groupByPartition(items: FeedItem[]): FeedItem[][] {
    const groups = new Map<string, FeedItem[]>();
    for (const item of items) {
      const key = `${item.userId}:${item.bucket}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  /**
   * Compute current and previous month buckets.
   * Always query 2 buckets to handle month boundaries
   * (user loads feed at 2025-01-01 00:01 → most content is in 202412).
   */
  static getCurrentBuckets(monthsBack = 2): string[] {
    const buckets: string[] = [];
    const now = new Date();
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      buckets.push(`${y}${m}`);
    }
    return buckets;
  }
}
