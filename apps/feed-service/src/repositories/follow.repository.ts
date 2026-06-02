/**
 * FeedService — FollowRepository
 *
 * In a pure microservices architecture, the feed-service would call
 * the user-service via gRPC to get follower lists. We wrap that gRPC call
 * here to keep the fanout worker decoupled from transport.
 *
 * In development (monolith mode), this could point to the same DB.
 * In production, replace with a gRPC client call to user-service.
 *
 * WHY a local wrapper instead of direct gRPC in the fanout worker:
 *   - Easier testing (mock this, not gRPC)
 *   - Can add local caching without polluting the worker
 *   - Single seam for follower data access
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '@hypercommerce/redis';

export interface FollowerItem {
  id: string;
  lastActiveAt: Date | null;
}

export interface FollowerBatchResult {
  items: FollowerItem[];
  nextCursor: string | null;
}

@Injectable()
export class FollowRepository {
  private readonly logger = new Logger(FollowRepository.name);

  constructor(
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Get a batch of followers for fan-out.
   *
   * Implementation strategy:
   *   The user-service maintains a Redis sorted set per user:
   *   key = "followers:{userId}", score = lastInteractionTs, member = followerId
   *
   *   This lets us get followers sorted by last activity — perfect for HYBRID strategy
   *   where we want to prioritize active followers.
   *
   *   Cursor = base64-encoded score offset for stable pagination.
   */
  async getFollowersBatch(
    userId: string,
    cursor?: string,
    limit = 500,
  ): Promise<FollowerBatchResult> {
    // In full implementation: gRPC call to user-service
    // For now: read from Redis sorted set written by user-service fan-out
    const key = `followers:${userId}`;
    const offset = cursor ? parseInt(Buffer.from(cursor, 'base64url').toString(), 10) : 0;

    try {
      // Score = last activity timestamp; WITHSCORES for lastActiveAt
      const raw = await this.redis.zrevrangeWithScores(key, offset, offset + limit - 1);

      const items: FollowerItem[] = raw.map((entry) => ({
        id: entry.value,
        lastActiveAt: entry.score > 0 ? new Date(entry.score) : null,
      }));

      const nextCursor = items.length === limit
        ? Buffer.from(String(offset + limit)).toString('base64url')
        : null;

      return { items, nextCursor };
    } catch (err) {
      this.logger.warn(`getFollowersBatch failed for ${userId}: ${String(err)}`);
      return { items: [], nextCursor: null };
    }
  }
}
