// ============================================================
// HYPERCOMMERCE — Sliding Window Rate Limiter (Redis)
//
// WHY SLIDING WINDOW over Token Bucket / Fixed Window?
//
// Fixed Window: burst problem — 200 req at 11:59:59 + 200 at 12:00:01
// Token Bucket: complex multi-server synchronization
// Sliding Window: uniform distribution, easy to implement with Redis
//   sorted sets, exact boundary behavior
//
// ALGORITHM:
// Uses Redis ZSET per (key = userId:endpoint):
// - Member: UUID (request ID)
// - Score: timestamp in ms
//
// On each request (Lua script, atomic):
// 1. Remove entries older than windowMs from ZSET
// 2. Count remaining entries
// 3. If count >= limit → reject
// 4. ZADD current request
// 5. Set TTL = windowMs
//
// WHY LUA SCRIPT?
// Steps 1-5 must be atomic. Without Lua, a race condition between
// step 2 (count) and step 4 (add) allows bursts above the limit.
//
// PERFORMANCE:
// Each check = 1 network round trip (EVALSHA)
// Redis sorted set ops = O(log N) where N = requests per window
// At 1000 rpm, N ≤ 1000 → effectively O(1) in practice
//
// SCALE:
// Redis cluster: shard by hash tag {userId} so all window data
// for a user lands on the same shard → atomic Lua works correctly.
// ============================================================

import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import { RateLimitExceededException } from '@hypercommerce/common/exceptions/domain.exceptions';

export interface RateLimitConfig {
  /** Requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** User tier identifier (for different rate buckets) */
  tier?: keyof typeof APP_CONSTANTS.RATE_LIMITS;
}

// ── Lua Script (atomic sliding window check) ──────────────────
// Returns: [0, remaining] if allowed, [-1, 0] if rejected
const LUA_SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local requestId = ARGV[4]

-- 1. Remove expired entries (outside window)
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 2. Count current entries
local count = redis.call('ZCARD', key)

-- 3. Reject if at limit
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  return {-1, retryAfter}
end

-- 4. Add this request
redis.call('ZADD', key, now, requestId)

-- 5. Set TTL (auto-cleanup)
redis.call('PEXPIRE', key, window)

return {0, limit - count - 1}
`;

@Injectable()
export class SlidingWindowRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SlidingWindowRateLimitMiddleware.name);

  constructor(private readonly redis: RedisClientService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = this.extractUserId(req);
    const userTier = this.extractTier(req);
    const endpoint = this.normalizeEndpoint(req.path);

    const config = this.getConfigForTier(userTier);
    const key = `${APP_CONSTANTS.REDIS_KEYS.RATE_LIMIT}${userId}:${endpoint}`;

    try {
      const result = await this.checkLimit(key, config);

      // Always set headers so clients can adapt
      res.setHeader('X-RateLimit-Limit', config.limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
      res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + config.windowMs) / 1000));

      if (result.rejected) {
        res.setHeader('Retry-After', result.retryAfterSeconds);

        this.logger.warn(
          JSON.stringify({
            event: 'rate_limit_exceeded',
            userId,
            tier: userTier,
            endpoint,
            retryAfter: result.retryAfterSeconds,
          }),
        );

        throw new RateLimitExceededException(userId, endpoint, result.retryAfterSeconds);
      }

      next();
    } catch (err) {
      if (err instanceof RateLimitExceededException) throw err;
      // Redis failure: fail open (allow request) — don't block users on infra issues
      this.logger.error(`Rate limit Redis error: ${String(err)} — failing open`);
      next();
    }
  }

  /**
   * Standalone check method (for use in guards, not just middleware).
   */
  async checkLimit(
    key: string,
    config: RateLimitConfig,
  ): Promise<{ rejected: boolean; remaining: number; retryAfterSeconds: number }> {
    const now = Date.now();
    const requestId = `${now}-${Math.random().toString(36).slice(2, 9)}`;

    const [status, value] = (await this.redis
      .getClient()
      .eval(
        LUA_SLIDING_WINDOW,
        1,
        key,
        String(now),
        String(config.windowMs),
        String(config.limit),
        requestId,
      )) as [number, number];

    if (status === -1) {
      return { rejected: true, remaining: 0, retryAfterSeconds: value };
    }

    return { rejected: false, remaining: value, retryAfterSeconds: 0 };
  }

  // ── Private ───────────────────────────────────────────────

  private extractUserId(req: Request): string {
    // JWT middleware should have populated req.user
    const user = (req as Request & { user?: { sub?: string; id?: string } }).user;
    return user?.sub ?? user?.id ?? req.ip ?? 'anonymous';
  }

  private extractTier(req: Request): keyof typeof APP_CONSTANTS.RATE_LIMITS {
    const user = (req as Request & { user?: { tier?: string } }).user;
    const tier = user?.tier?.toUpperCase();
    if (tier && tier in APP_CONSTANTS.RATE_LIMITS) {
      return tier as keyof typeof APP_CONSTANTS.RATE_LIMITS;
    }
    return 'FREE';
  }

  private normalizeEndpoint(path: string): string {
    // Replace UUIDs and numeric IDs with wildcards for grouping
    // /orders/550e8400-e29b-41d4-a716-446655440000 → /orders/:id
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/\d+/g, '/:id');
  }

  private getConfigForTier(tier: keyof typeof APP_CONSTANTS.RATE_LIMITS): RateLimitConfig {
    const limits = APP_CONSTANTS.RATE_LIMITS[tier];
    return {
      limit: limits.rpm,
      windowMs: 60_000, // 1 minute window
      tier,
    };
  }
}
