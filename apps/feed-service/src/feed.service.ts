// ============================================================
// HYPERCOMMERCE — Feed Service
// Orchestrates: Cassandra read → user embed load → A/B weights
// → v1 linear scoring → sort → paginate → Redis cache.
//
// Cache key:  feed:feat:user:{userId}   TTL = 300 s
// User embed: user:embed:{userId}       loaded from Redis (ai-service writes)
// A/B variant: feed:ab:{userId}         TTL = 7 d
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { FeedRepository } from './repositories/feed.repository';
import { FeedRepository as FeedRepositoryClass } from './repositories/feed.repository';
import type { RankingService, FeedEvent, ScoringResult } from './ranking/ranking.service';
import type { AbWeightResolverService } from './ranking/ab-weight-resolver.service';
import type { FeedItem } from './repositories/feed.repository';

// ── Response types ────────────────────────────────────────────

export interface RankedItem extends ScoringResult {
  authorId: string;
  authorUsername: string;
  postType: string;
  contentPreview: string;
  mediaUrl?: string;
  productId?: string;
  createdAt: string;
}

export interface GetRankedFeedResult {
  items: RankedItem[];
  cursor: string | null;
  hasMore: boolean;
  meta: {
    variant: 'v1' | 'v2';
    fromCache: boolean;
    totalScored: number;
  };
}

// ── Cursor codec ─────────────────────────────────────────────

interface CursorPayload {
  page: number;
  userId: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  private readonly PAGE_SIZE = APP_CONSTANTS.FEED_PAGE_SIZE;
  private readonly FETCH_LIMIT = APP_CONSTANTS.FEED_FETCH_LIMIT;
  private readonly CACHE_TTL = APP_CONSTANTS.FEED_RANKED_TTL_SECONDS;

  constructor(
    private readonly feedRepository: FeedRepository,
    private readonly rankingService: RankingService,
    private readonly abResolver: AbWeightResolverService,
    private readonly redis: RedisClientService,
  ) {}

  /**
   * Get a ranked, paginated feed for a user.
   *
   * Pipeline:
   * 1. Cache hit → return cached ranked items for the requested page
   * 2. Fetch raw items from Cassandra (last 2 months)
   * 3. Load user embedding from Redis (user:embed:{userId})
   * 4. Resolve A/B weights (feed:ab:{userId})
   * 5. Score each item with RankingService.score()
   * 6. Sort by finalScore DESC
   * 7. Cache full ranked list
   * 8. Slice requested page, encode cursor
   */
  async getRankedFeed(
    userId: string,
    cursor?: string,
    limit: number = this.PAGE_SIZE,
  ): Promise<GetRankedFeedResult> {
    const pageSize = Math.min(limit, 50);
    const page = cursor ? (decodeCursor(cursor)?.page ?? 0) : 0;

    // ── 1. Try cache ──────────────────────────────────────────
    const cacheKey = `${APP_CONSTANTS.REDIS_KEYS.FEED_RANKED}${userId}`;
    const cached = await this.tryReadCache(cacheKey);

    if (cached) {
      return this.paginateRanked(cached.items, cached.variant, page, pageSize, userId, true);
    }

    // ── 2. Fetch raw items from Cassandra ─────────────────────
    const buckets = FeedRepositoryClass.getCurrentBuckets(2); // last 2 months
    const rawItems = await this.feedRepository.getFeedItems({
      userId,
      buckets,
      limit: this.FETCH_LIMIT,
    });

    if (!rawItems.length) {
      return {
        items: [],
        cursor: null,
        hasMore: false,
        meta: { variant: 'v1', fromCache: false, totalScored: 0 },
      };
    }

    // ── 3. Load user embedding ────────────────────────────────
    const userEmbed = await this.loadUserEmbed(userId);

    // ── 4. Resolve A/B weights ────────────────────────────────
    const { weights, variant } = await this.abResolver.resolveWeights(userId);

    // ── 5. Score each item ────────────────────────────────────
    const events = rawItems.map(this.toFeedEvent);
    const scored = this.rankingService.scoreAll(events, { userId, userEmbed, weights });

    // Annotate variant onto each result
    const annotated = scored.map((s) => ({ ...s, variant }));

    // ── 6. Sort by finalScore DESC ────────────────────────────
    annotated.sort((a, b) => b.finalScore - a.finalScore);

    // Build enriched items (merge back metadata from rawItems)
    const itemMap = new Map<string, FeedItem>(rawItems.map((r) => [r.postId, r]));
    const rankedItems: RankedItem[] = annotated.map((s) => {
      const raw = itemMap.get(s.postId)!;
      return {
        ...s,
        authorId: raw.authorId,
        authorUsername: raw.authorUsername,
        postType: raw.postType,
        contentPreview: raw.contentPreview,
        mediaUrl: raw.mediaUrl,
        productId: raw.productId,
        createdAt: raw.createdAt.toISOString(),
      };
    });

    // ── 7. Cache full ranked list ─────────────────────────────
    await this.writeCache(cacheKey, { items: rankedItems, variant });

    return this.paginateRanked(rankedItems, variant, page, pageSize, userId, false);
  }

  /**
   * Invalidate the feed cache for a user.
   * Called by FeedFanoutWorker after writing new posts to Cassandra.
   */
  async invalidateCache(userId: string): Promise<void> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.FEED_RANKED}${userId}`;
    await this.redis.getClient().del(key);
  }

  // ── Private helpers ───────────────────────────────────────────

  private paginateRanked(
    items: RankedItem[],
    variant: 'v1' | 'v2',
    page: number,
    pageSize: number,
    userId: string,
    fromCache: boolean,
  ): GetRankedFeedResult {
    const start = page * pageSize;
    const slice = items.slice(start, start + pageSize + 1);
    const hasMore = slice.length > pageSize;
    const pageItems = slice.slice(0, pageSize);

    const nextCursor = hasMore ? encodeCursor({ page: page + 1, userId }) : null;

    return {
      items: pageItems,
      cursor: nextCursor,
      hasMore,
      meta: { variant, fromCache, totalScored: items.length },
    };
  }

  /**
   * Load the user interest embedding from Redis.
   * Written by ai-service when user behaviour is processed.
   * Key: user:embed:{userId}  Value: JSON float32 array (768-dim)
   */
  private async loadUserEmbed(userId: string): Promise<number[] | undefined> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.FEED_USER_EMBED}${userId}`;
    try {
      const raw = await this.redis.getClient().get(key);
      if (!raw) return undefined;
      return JSON.parse(raw) as number[];
    } catch {
      this.logger.warn(`Failed to parse user embed for ${userId}`);
      return undefined;
    }
  }

  private async tryReadCache(
    key: string,
  ): Promise<{ items: RankedItem[]; variant: 'v1' | 'v2' } | null> {
    try {
      const raw = await this.redis.getClient().get(key);
      if (!raw) return null;
      return JSON.parse(raw) as { items: RankedItem[]; variant: 'v1' | 'v2' };
    } catch {
      return null;
    }
  }

  private async writeCache(
    key: string,
    payload: { items: RankedItem[]; variant: 'v1' | 'v2' },
  ): Promise<void> {
    try {
      await this.redis.getClient().set(key, JSON.stringify(payload), 'EX', this.CACHE_TTL);
    } catch (err) {
      this.logger.warn(`Feed cache write failed: ${(err as Error).message}`);
    }
  }

  /**
   * Map a Cassandra FeedItem to the FeedEvent shape expected by RankingService.
   * Post-level engagement signals are precomputed by the ML rank worker and
   * stored on the feed_items row; they are already normalised to [0, 1].
   */
  private toFeedEvent(item: FeedItem): FeedEvent {
    return {
      postId: item.postId,
      authorId: item.authorId,
      authorUsername: item.authorUsername,
      postType: item.postType,
      contentPreview: item.contentPreview,
      mediaUrl: item.mediaUrl,
      productId: item.productId,
      // completionRate and purchaseRate not stored on FeedItem — use 0 as safe default
      // (ML rank worker updates these via score field when available)
      completionRate: item.engagementRate,
      purchaseRate: 0,
      shareRate: item.shareCount > 0 ? Math.min(item.shareCount / (item.likeCount + 1), 1) : 0,
      createdAt: item.createdAt,
    };
  }
}
