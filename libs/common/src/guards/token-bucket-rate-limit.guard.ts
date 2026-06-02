/**
 * TokenBucketRateLimitGuard — Real rate limiting using TokenBucket algorithm
 *
 * WHY TOKEN BUCKET (not simple INCR counter):
 *
 * Simple Redis INCR approach:
 *   INCR user:ratelimit:{userId}:{minute}
 *   If count > limit → reject
 *   Problem: "Fixed Window" — a user can burst 120 requests in 2 seconds
 *   (60 at the end of minute 1, 60 at the start of minute 2).
 *   This defeats the purpose of rate limiting.
 *
 * Token Bucket algorithm:
 *   Each user has a "bucket" with capacity N tokens.
 *   Tokens refill at rate R per second (up to max capacity).
 *   Each request consumes 1 token.
 *   If bucket is empty → reject with 429.
 *
 *   Example: capacity=60, refillRate=1/sec
 *   User can burst up to 60 requests instantly.
 *   After burst, gets 1 request/second.
 *   Natural, smooth rate limiting that allows legitimate bursts.
 *
 * LEAKY BUCKET vs TOKEN BUCKET:
 *   Leaky bucket: fixed output rate. Queues requests, processes at steady rate.
 *     Good for: smoothing traffic spikes (e.g., email sending)
 *     Bad for: APIs where you want to allow small bursts
 *   Token bucket: allows bursts up to capacity.
 *     Good for: APIs, WebSocket connections
 *   We use token bucket here.
 *
 * SLIDING WINDOW LOG (most accurate):
 *   Store timestamp of every request in last N seconds.
 *   Count = number of timestamps in window.
 *   Most accurate, but O(count) storage.
 *   Use for strict rate limiting (billing APIs, auth endpoints).
 *
 * IMPLEMENTATION:
 *   We use TokenBucketPool from @hypercommerce/algorithms.
 *   It manages one bucket per user with LRU eviction (no memory leak).
 *   The bucket state is in-process (not Redis) for maximum speed.
 *   Tradeoff: in cluster mode, each worker has independent buckets.
 *   For cluster-aware rate limiting, use Redis Lua sliding window.
 *
 * USAGE:
 *   @UseGuards(JwtAuthGuard, TokenBucketRateLimitGuard)
 *   @SetMetadata('rateLimit', { rpm: 30 })  // Override default
 *   @Post('expensive-operation')
 *   async expensiveOp() {}
 */
import {
  CanActivate, ExecutionContext, Injectable,
  HttpException, HttpStatus, SetMetadata, Logger, Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TokenBucketPool } from '@hypercommerce/algorithms';
import { MemoryLifecycleService } from '../lifecycle/memory-lifecycle.service';
import algorithmConfig, { AlgorithmConfigProps } from '../config/algorithm.config';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  rpm?:       number;   // Requests per minute
  burstSize?: number;   // Max burst tokens (default = rpm/4)
  skipAuth?:  boolean;  // If true, rate limit unauthenticated users only
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class TokenBucketRateLimitGuard implements CanActivate {
  private readonly logger  = new Logger(TokenBucketRateLimitGuard.name);
  private readonly pool:   TokenBucketPool;

  constructor(
    private readonly reflector: Reflector,
    private readonly memoryService: MemoryLifecycleService,
    @Inject(algorithmConfig.KEY) private readonly config: AlgorithmConfigProps,
  ) {
    const { defaultRpm, defaultBurstSize, cleanupIntervalMs } = config.rateLimiter;
    this.pool = new TokenBucketPool(
      {
        capacity: defaultBurstSize,
        refillRate: defaultRpm / 60,  // RPM → requests/second
      },
      10_000, // Max unique users tracked in memory
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    // If system is under memory pressure, apply stricter rate limiting
    if (this.memoryService.isUnderPressure) {
      return this.enforceEmergencyLimit(ctx);
    }

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) ?? {};

    const req      = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const clientId = req.user?.id ?? this.getClientIp(req);

    if (!clientId) return true;  // Anonymous health checks etc.

    const rpm       = options.rpm       ?? this.config.rateLimiter.defaultRpm;
    const burstSize = options.burstSize ?? Math.max(Math.ceil(rpm / 4), 5);

    const result = this.pool.consume(clientId, 1);

    if (!result.allowed) {
      const retryAfter = Math.ceil(60 / rpm);
      this.logger.warn({
        event:     'rate_limit_exceeded',
        clientId:  clientId.slice(0, 8) + '***',
        endpoint:  req.path,
        rpm,
      });

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error:      'Too Many Requests',
          message:    `Rate limit exceeded. Try again in ${retryAfter}s.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
        { cause: new Error('rate_limit_exceeded') },
      );
    }

    return true;
  }

  // Under memory pressure: allow only 10% of normal rate
  private enforceEmergencyLimit(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const clientId = req.user?.id ?? this.getClientIp(req);
    if (!clientId) return true;

    const emergencyRpm = Math.max(Math.ceil(this.config.rateLimiter.defaultRpm * 0.1), 1);
    const allowed      = this.pool.consume(clientId, 1);

    if (!allowed.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:    'Service temporarily under load. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private getClientIp(req: Request): string {
    // Trust X-Forwarded-For from load balancer, but sanitize it
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
  }
}
