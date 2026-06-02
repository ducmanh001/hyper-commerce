// ============================================================
// HYPERCOMMERCE — Rate Limit Guard
// Token bucket algorithm via Redis.
//
// Tại sao Token Bucket thay vì Fixed Window?
// Fixed window: 100 req/min → user can burst 100 req in 1 second
//   right at window boundary (100 + 100 = 200 in 2 seconds window)
// Token bucket: smooth rate — refill 1 token/600ms → truly 100/min
//   no burst amplification at window edges.
//
// Lua script ensures atomicity: check AND consume in one operation.
// ============================================================

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RedisClientService } from '@hypercommerce/redis';

export const RATE_LIMIT_KEY = 'RATE_LIMIT';

export interface RateLimitConfig {
  limit: number;    // Max tokens
  window: number;   // Window in seconds
  keyBy?: 'ip' | 'user' | 'custom';
}

// Token bucket Lua script — atomic check + consume
const TOKEN_BUCKET_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])   -- tokens per second
  local now = tonumber(ARGV[3])           -- current time in ms
  local cost = tonumber(ARGV[4])          -- tokens per request

  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1]) or capacity
  local last_refill = tonumber(bucket[2]) or now

  -- Refill tokens based on elapsed time
  local elapsed = (now - last_refill) / 1000
  tokens = math.min(capacity, tokens + elapsed * refill_rate)

  if tokens >= cost then
    tokens = tokens - cost
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) * 2)
    return {1, math.floor(tokens)}
  else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) * 2)
    return {0, math.floor(tokens)}
  end
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisClientService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<RateLimitConfig>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Default: 100 requests per minute
    const { limit = 100, window = 60, keyBy = 'ip' } = config ?? {};

    const req = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const res = context.switchToHttp().getResponse<Response>();

    const identifier = this.getIdentifier(req, keyBy);
    const bucketKey = `ratelimit:${identifier}`;

    const result = await (this.redis.getClient() as import('ioredis').Redis).eval(
      TOKEN_BUCKET_LUA,
      1,
      bucketKey,
      limit,
      limit / window, // refill rate = limit/window tokens per second
      Date.now(),
      1,              // cost = 1 token per request
    ) as [number, number];

    const [allowed, remaining] = result;

    // Set rate limit headers (RFC 6585)
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + window);

    if (!allowed) {
      res.setHeader('Retry-After', window);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please slow down.',
          retryAfter: window,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getIdentifier(
    req: Request & { userId?: string },
    keyBy: string,
  ): string {
    switch (keyBy) {
      case 'user':
        return req.userId ?? this.getIp(req);
      case 'ip':
      default:
        return this.getIp(req);
    }
  }

  private getIp(req: Request): string {
    // Trust X-Forwarded-For only behind known proxies
    // In production: configure based on TRUSTED_PROXY env
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? '0.0.0.0';
  }
}
