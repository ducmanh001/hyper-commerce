// ============================================================
// HYPERCOMMERCE — Viewer Count Service
// Real-time viewer counting cho 100K concurrent livestreams.
//
// Tại sao Redis Sorted Set?
// - ZADD O(log N) — fast even với millions of viewers
// - ZCARD O(1) — instant count
// - ZRANGEBYSCORE — get active viewers in time window
// - TTL on members — auto-cleanup inactive viewers
//
// Pattern: Set member = userId, Score = timestamp of join
// ZREMRANGEBYSCORE removes viewers inactive > 5 minutes
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

@Injectable()
export class ViewerCountService {
  private readonly logger = new Logger(ViewerCountService.name);
  private readonly KEY_PREFIX = APP_CONSTANTS.REDIS_KEYS.STREAM_VIEWERS;
  // Viewer considered active if heartbeat within last 5 minutes
  private readonly VIEWER_TTL_SECONDS = 300;

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Add viewer to stream.
   * Score = current timestamp → enables time-based expiry.
   */
  async incrementViewer(streamId: string, userId: string): Promise<void> {
    const key = `${this.KEY_PREFIX}${streamId}`;
    const now = Date.now();
    await this.redis.zadd(key, now, userId);
    // Set TTL on the entire key — if stream ends, key auto-expires
    await this.redis.expire(key, 86_400); // 24h max stream
  }

  /**
   * Remove viewer from stream.
   * Called on disconnect or explicit leave.
   */
  async decrementViewer(streamId: string, userId: string): Promise<void> {
    const key = `${this.KEY_PREFIX}${streamId}`;
    await (this.redis.getClient() as import('ioredis').Redis).zrem(key, userId);
  }

  /**
   * Get current ACTIVE viewer count.
   *
   * Active = joined in last 5 minutes (heartbeat-based).
   * This eliminates ghost connections (tabs left open, crashed clients).
   *
   * Uses ZCOUNT with score range [now - 5min, +inf]
   */
  async getViewerCount(streamId: string): Promise<number> {
    const key = `${this.KEY_PREFIX}${streamId}`;
    const cutoff = Date.now() - this.VIEWER_TTL_SECONDS * 1000;

    const count = await (this.redis.getClient() as import('ioredis').Redis).zcount(
      key,
      cutoff,
      '+inf',
    );

    return count;
  }

  /**
   * Heartbeat — user sends ping every 30 seconds.
   * Updates viewer score to current timestamp = marks as active.
   */
  async heartbeat(streamId: string, userId: string): Promise<void> {
    const key = `${this.KEY_PREFIX}${streamId}`;
    const isInStream = await (this.redis.getClient() as import('ioredis').Redis).zscore(
      key,
      userId,
    );

    if (isInStream !== null) {
      // Update timestamp score — refreshes "active" window
      await this.redis.zadd(key, Date.now(), userId);
    }
  }

  /**
   * Cleanup stale viewers — removes entries older than TTL.
   * Called periodically by a cron job or on each count request.
   */
  async cleanupStaleViewers(streamId: string): Promise<number> {
    const key = `${this.KEY_PREFIX}${streamId}`;
    const cutoff = Date.now() - this.VIEWER_TTL_SECONDS * 1000;

    return (this.redis.getClient() as import('ioredis').Redis).zremrangebyscore(
      key,
      '-inf',
      cutoff,
    );
  }

  /**
   * Get top N streams by viewer count — for discovery/trending.
   * Uses Redis ZRANGEBYSCORE across stream leaderboard key.
   */
  async getTopStreams(limit = 20): Promise<Array<{ streamId: string; count: number }>> {
    const leaderboardKey = 'live:leaderboard';
    const results = await (this.redis.getClient() as import('ioredis').Redis).zrangebyscore(
      leaderboardKey,
      '-inf',
      '+inf',
      'WITHSCORES',
      'LIMIT',
      0,
      limit,
    );

    // Parse paired array: [streamId, score, streamId, score, ...]
    const streams: Array<{ streamId: string; count: number }> = [];
    for (let i = 0; i < results.length; i += 2) {
      streams.push({
        streamId: results[i],
        count: Number(results[i + 1]),
      });
    }

    return streams.reverse(); // Highest count first
  }

  /**
   * Update stream leaderboard when viewer count changes.
   * Called after increment/decrement.
   */
  async updateLeaderboard(streamId: string): Promise<void> {
    const count = await this.getViewerCount(streamId);
    const leaderboardKey = 'live:leaderboard';

    if (count > 0) {
      await this.redis.zadd(leaderboardKey, count, streamId);
    } else {
      await (this.redis.getClient() as import('ioredis').Redis).zrem(
        leaderboardKey,
        streamId,
      );
    }
  }
}
