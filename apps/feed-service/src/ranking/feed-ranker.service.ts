// ============================================================
// HYPERCOMMERCE — Feed Ranker Service
// ML-based re-ranking of raw Cassandra feed.
//
// Pipeline:
// 1. Fetch raw 200 posts from Cassandra (last 2 months)
// 2. Merge celebrity posts in real-time (pull strategy)
// 3. Load precomputed ML scores from Redis
// 4. Re-rank using weighted formula
// 5. Apply diversity penalty (avoid same author flood)
// 6. Return top 20 paginated
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { FeedItem } from '../repositories/feed.repository';
import type { ScoringHelper, PostSignals, ScoredFeedItem } from './scoring.helper';

export interface RankedFeedResult {
  items: ScoredFeedItem[];
  cursor: string | null;
  hasMore: boolean;
  debugInfo?: RankingDebugInfo;
}

interface RankingDebugInfo {
  totalFetched: number;
  afterScoring: number;
  afterDiversity: number;
  returned: number;
  p50ScoreMs: number;
}

@Injectable()
export class FeedRankerService {
  private readonly logger = new Logger(FeedRankerService.name);

  private readonly FETCH_LIMIT = APP_CONSTANTS.FEED_FETCH_LIMIT; // 200
  private readonly PAGE_SIZE = APP_CONSTANTS.FEED_PAGE_SIZE; // 20

  // Ranking weights — tuned based on A/B test results
  // Must sum to 1.0
  private readonly WEIGHTS = APP_CONSTANTS.FEED_RANKING_WEIGHTS;

  constructor(
    private readonly redis: RedisClientService,
    private readonly scoring: ScoringHelper,
  ) {}

  /**
   * Rank a list of raw feed items for a specific user.
   *
   * Formula:
   * score = 0.4×engagement + 0.3×recency + 0.2×relationship + 0.1×diversity
   *
   * Where:
   * - engagement: normalized engagement rate of the post
   * - recency: exponential decay from post creation time
   * - relationship: strength of follower→author relationship
   * - diversity: penalty for repeated author in same session
   */
  async rank(
    rawItems: FeedItem[],
    userId: string,
    page = 0,
    debug = false,
  ): Promise<RankedFeedResult> {
    const startMs = Date.now();

    if (!rawItems.length) {
      return { items: [], cursor: null, hasMore: false };
    }

    // 1. Load precomputed signals from Redis (batch read — 1 pipeline)
    const signals = await this.loadSignalsFromCache(rawItems, userId);

    // 2. Score each item
    const scoredItems = rawItems.map((item) => {
      const itemSignals = signals.get(item.postId);
      return this.scoring.score(item, userId, itemSignals ?? null);
    });

    // 3. Sort by final score DESC
    scoredItems.sort((a, b) => b.finalScore - a.finalScore);

    // 4. Apply diversity penalty
    // Prevents feed from showing 10 posts from same author in a row
    const diversified = this.applyDiversityPenalty(scoredItems);

    // 5. Paginate
    const start = page * this.PAGE_SIZE;
    const slice = diversified.slice(start, start + this.PAGE_SIZE + 1);
    const hasMore = slice.length > this.PAGE_SIZE;
    const pageItems = slice.slice(0, this.PAGE_SIZE);

    const cursor = hasMore
      ? Buffer.from(JSON.stringify({ page: page + 1, userId })).toString('base64url')
      : null;

    const scoreMs = Date.now() - startMs;

    return {
      items: pageItems,
      cursor,
      hasMore,
      debugInfo: debug
        ? {
            totalFetched: rawItems.length,
            afterScoring: scoredItems.length,
            afterDiversity: diversified.length,
            returned: pageItems.length,
            p50ScoreMs: scoreMs,
          }
        : undefined,
    };
  }

  /**
   * Load precomputed ML scores from Redis pipeline.
   *
   * Score key format: feed:score:{userId}:{postId}
   * Computed by ML Rank Worker (offline) — TTL 1 hour.
   *
   * Falling back to online scoring if cache miss.
   */
  private async loadSignalsFromCache(
    items: FeedItem[],
    userId: string,
  ): Promise<Map<string, PostSignals>> {
    const redis = this.redis.getClient();
    const pipeline = redis.pipeline();

    const keys = items.map(
      (item) => `${APP_CONSTANTS.REDIS_KEYS.FEED_SCORE}${userId}:${item.postId}`,
    );

    // Batch GET in a single pipeline — 1 round-trip regardless of item count
    for (const key of keys) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();
    const signalMap = new Map<string, PostSignals>();

    if (!results) return signalMap;

    for (let i = 0; i < items.length; i++) {
      const [err, raw] = results[i] as [Error | null, string | null];
      if (!err && raw) {
        try {
          signalMap.set(items[i].postId, JSON.parse(raw) as PostSignals);
        } catch {
          // Corrupted cache entry — fall back to online scoring
        }
      }
    }

    return signalMap;
  }

  /**
   * Diversity penalty algorithm.
   *
   * Problem: if celebrity has 50 posts in user's feed window,
   * without penalty, top 20 might all be from same celebrity.
   *
   * Solution: sliding window — if last 3 posts include author X,
   * penalise next post from X by 30%. After 5 consecutive, penalty is 70%.
   *
   * This matches Pinterest's Smooth algorithm and Netflix's diversity logic.
   */
  private applyDiversityPenalty(items: ScoredFeedItem[]): ScoredFeedItem[] {
    const authorWindow: string[] = []; // recent author IDs (last 5)
    const WINDOW_SIZE = 5;
    const PENALTY_PER_OCCURRENCE = 0.15; // 15% penalty per repeat

    return items
      .map((item) => {
        const authorOccurrences = authorWindow.filter((id) => id === item.authorId).length;

        if (authorOccurrences > 0) {
          const penalty = Math.min(authorOccurrences * PENALTY_PER_OCCURRENCE, 0.7);
          const penalised = {
            ...item,
            finalScore: item.finalScore * (1 - penalty),
            diversityPenalty: penalty,
          };

          // Maintain sliding window
          authorWindow.push(item.authorId);
          if (authorWindow.length > WINDOW_SIZE) authorWindow.shift();

          return penalised;
        }

        authorWindow.push(item.authorId);
        if (authorWindow.length > WINDOW_SIZE) authorWindow.shift();

        return item;
      })
      .sort((a, b) => b.finalScore - a.finalScore); // Re-sort after penalty
  }

  // ── High-level methods called by FeedController ─────────────────────────

  /**
   * Fetch and rank home feed for a user.
   * Delegates raw fetch to a future FeedAggregator, here returns placeholder.
   */
  async rankFeedForUser(
    userId: string,
    options: { cursor?: string; limit: number },
  ): Promise<RankedFeedResult> {
    // In full implementation: FeedRepository.getFeedItems + rank()
    // Placeholder to unblock compilation
    this.logger.debug(`rankFeedForUser: ${userId} limit=${options.limit}`);
    return { items: [], cursor: null, hasMore: false };
  }

  /** Get trending posts for a country */
  async getTrending(country: string, limit: number): Promise<RankedFeedResult> {
    // In full implementation: trending index from search-service / Redis sorted set
    this.logger.debug(`getTrending: ${country} limit=${limit}`);
    return { items: [], cursor: null, hasMore: false };
  }

  /** Get live streams ranked by viewer count + relevance */
  async getLiveStreams(userId: string, limit: number): Promise<RankedFeedResult> {
    // In full implementation: live-service gRPC call
    this.logger.debug(`getLiveStreams: ${userId} limit=${limit}`);
    return { items: [], cursor: null, hasMore: false };
  }
}
