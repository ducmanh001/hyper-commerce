import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '@hypercommerce/redis';

/**
 * SearchAnalyticsService — tracks search behavior for personalization.
 *
 * Data collected:
 * - Query strings + result click positions (CTR)
 * - Zero-result queries (merchandising opportunities)
 * - Session-based query sequences (for query suggestions)
 * - A/B test assignments
 *
 * Storage: Redis Sorted Sets (ZSETs) for trending queries
 */
@Injectable()
export class SearchAnalyticsService {
  private readonly logger = new Logger(SearchAnalyticsService.name);

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Record a search event.
   * Increments query frequency in Redis ZSET.
   * TTL: 24 hours (trending = recent).
   */
  async recordSearch(query: string, userId?: string, resultCount?: number): Promise<void> {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return;

    const now = Date.now();
    const hourKey = `trending:${new Date().toISOString().substring(0, 13)}`; // YYYY-MM-DDTHH

    // Increment in hourly ZSET for trending
    await this.redis.zincrby(hourKey, 1, normalizedQuery);
    await this.redis.expire(hourKey, 86400); // 24 hour TTL

    // Record zero-result queries separately for merchandising team
    if (resultCount === 0) {
      await this.redis.zincrby('zero_results:today', 1, normalizedQuery);
    }
  }

  /**
   * Get trending queries from last N hours.
   * Merge multiple hourly ZSETs for rolling window.
   */
  async getTopQueries(from?: string, to?: string, limit = 20): Promise<Array<{ query: string; count: number }>> {
    // Use last 1 hour for real-time trending
    const hourKey = `trending:${new Date().toISOString().substring(0, 13)}`;
    const results = await this.redis.zrevrangeWithScores(hourKey, 0, limit - 1);
    return results.map((r) => ({ query: r.value, count: Math.floor(r.score) }));
  }

  async getZeroResultQueries(limit = 20): Promise<Array<{ query: string; count: number }>> {
    const results = await this.redis.zrevrangeWithScores('zero_results:today', 0, limit - 1);
    return results.map((r) => ({ query: r.value, count: Math.floor(r.score) }));
  }
}
