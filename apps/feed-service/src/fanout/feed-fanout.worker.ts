// ============================================================
// HYPERCOMMERCE — Feed Fan-out Worker
// Xử lý push/pull hybrid fan-out khi user publish post.
//
// Consumed từ Kafka topic: feed-signals
// Logic:
// - Regular user (PUSH): iterate followers, write to each feed
// - Celebrity (PULL): skip fan-out, readers query on demand
// - Hybrid (MEGA): push to active followers only
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { MessageHandler, MessageMetadata } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { FeedItem } from '../repositories/feed.repository';
import { FeedRepository } from '../repositories/feed.repository';
import type { FollowRepository } from '../repositories/follow.repository';
import type { CelebrityDetectorHelper } from '../helpers/celebrity-detector.helper';

interface PostPublishedEvent {
  type: 'POST_PUBLISHED';
  postId: string;
  authorId: string;
  authorUsername: string;
  postType: string;
  contentPreview: string;
  mediaUrl?: string;
  productId?: string;
  fanoutStrategy: 'PUSH' | 'PULL' | 'HYBRID';
  followerCount: number;
  publishedAt: string;
  engagementBaseline: number;
}

@Injectable()
export class FeedFanoutWorker implements MessageHandler<PostPublishedEvent> {
  readonly topic = APP_CONSTANTS.KAFKA_TOPICS.FEED_SIGNALS;

  private readonly logger = new Logger(FeedFanoutWorker.name);

  constructor(
    private readonly feedRepo: FeedRepository,
    private readonly followRepo: FollowRepository,
    private readonly celebrityDetector: CelebrityDetectorHelper,
  ) {}

  /**
   * Main fan-out handler — called for every POST_PUBLISHED event.
   *
   * Key insight: this handler must be idempotent.
   * Kafka at-least-once means it may be called twice for the same post.
   * Cassandra INSERT with same primary key is idempotent (upsert semantics).
   */
  async handle(event: PostPublishedEvent, meta: MessageMetadata): Promise<void> {
    if (event.type !== 'POST_PUBLISHED') return;

    this.logger.log(
      JSON.stringify({
        event: 'fanout_start',
        postId: event.postId,
        authorId: event.authorId,
        strategy: event.fanoutStrategy,
        traceId: meta.traceId,
      }),
    );

    switch (event.fanoutStrategy) {
      case 'PUSH':
        await this.pushFanout(event, meta.traceId);
        break;
      case 'PULL':
        // No fan-out needed — readers will merge on demand
        this.logger.log(`PULL strategy: skip fan-out for ${event.postId}`);
        break;
      case 'HYBRID':
        await this.hybridFanout(event, meta.traceId);
        break;
    }
  }

  /**
   * PUSH fan-out: write post to every follower's feed.
   *
   * Batched to avoid overwhelming Cassandra:
   * - Fetch followers in pages of 500
   * - Write feed items in batches of 100
   * - Total throughput: ~10K writes/second per worker instance
   *
   * For 10K followers: ~20 batches × 500 followers = done in ~2 seconds.
   */
  private async pushFanout(event: PostPublishedEvent, traceId: string): Promise<void> {
    const batchSize = this.celebrityDetector.getFanoutBatchSize(event.followerCount);

    let cursor: string | undefined;
    let totalWritten = 0;
    const publishedAt = new Date(event.publishedAt);
    const bucket = FeedRepository.getCurrentBuckets(1)[0];

    do {
      // Fetch follower batch
      const { items: followers, nextCursor } = await this.followRepo.getFollowersBatch(
        event.authorId,
        cursor,
        batchSize,
      );

      if (!followers.length) break;

      // Build feed items for this batch
      const feedItems: FeedItem[] = followers.map((follower) => ({
        userId: follower.id,
        bucket,
        createdAt: publishedAt,
        postId: event.postId,
        authorId: event.authorId,
        authorUsername: event.authorUsername,
        postType: event.postType as FeedItem['postType'],
        contentPreview: event.contentPreview,
        mediaUrl: event.mediaUrl,
        productId: event.productId,
        score: 0, // Will be scored at read time
        engagementRate: event.engagementBaseline,
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
      }));

      // Batch write to Cassandra — 100 items at once
      const writeBatchSize = 100;
      for (let i = 0; i < feedItems.length; i += writeBatchSize) {
        await this.feedRepo.batchInsertFeedItems(feedItems.slice(i, i + writeBatchSize));
      }

      totalWritten += feedItems.length;
      cursor = nextCursor ?? undefined;
    } while (cursor);

    this.logger.log(
      JSON.stringify({
        event: 'fanout_complete',
        postId: event.postId,
        strategy: 'PUSH',
        totalWritten,
        traceId,
      }),
    );
  }

  /**
   * HYBRID fan-out: push only to active followers (last 7 days).
   * Saves DB writes for ghost accounts / inactive users.
   * Used for mega-celebrities (>1M followers).
   */
  private async hybridFanout(event: PostPublishedEvent, traceId: string): Promise<void> {
    let cursor: string | undefined;
    let totalWritten = 0;
    let totalSkipped = 0;

    const bucket = FeedRepository.getCurrentBuckets(1)[0];
    const publishedAt = new Date(event.publishedAt);

    do {
      const { items: followers, nextCursor } = await this.followRepo.getFollowersBatch(
        event.authorId,
        cursor,
        200,
      );

      if (!followers.length) break;

      // Filter to active followers only
      const activeFollowers = followers.filter((f) =>
        this.celebrityDetector.shouldPushToFollower('HYBRID', f.lastActiveAt),
      );

      totalSkipped += followers.length - activeFollowers.length;

      if (activeFollowers.length > 0) {
        const feedItems: FeedItem[] = activeFollowers.map((follower) => ({
          userId: follower.id,
          bucket,
          createdAt: publishedAt,
          postId: event.postId,
          authorId: event.authorId,
          authorUsername: event.authorUsername,
          postType: event.postType as FeedItem['postType'],
          contentPreview: event.contentPreview,
          mediaUrl: event.mediaUrl,
          productId: event.productId,
          score: 0,
          engagementRate: event.engagementBaseline,
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
        }));

        await this.feedRepo.batchInsertFeedItems(feedItems);
        totalWritten += feedItems.length;
      }

      cursor = nextCursor ?? undefined;
    } while (cursor);

    this.logger.log(
      JSON.stringify({
        event: 'fanout_complete',
        postId: event.postId,
        strategy: 'HYBRID',
        totalWritten,
        totalSkipped,
        traceId,
      }),
    );
  }
}
