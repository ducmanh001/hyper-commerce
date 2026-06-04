// ============================================================
// HYPERCOMMERCE — Idempotency Service
// Ensures at-most-once semantics cho payment và order creation.
//
// Pattern:
// 1. Check Redis for existing result → return if found
// 2. Process request
// 3. Store result in Redis with TTL
//
// Why Redis (not DB)?
// - Sub-millisecond lookup — on the critical path
// - TTL built-in — no cleanup needed
// - Atomic SETNX — prevents race on concurrent identical requests
//
// Key format: idem:{service}:{idempotency_key}
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

export interface IdempotencyRecord<T> {
  result: T;
  processedAt: string;
  requestHash: string;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly PREFIX = APP_CONSTANTS.REDIS_KEYS.IDEMPOTENCY;
  private readonly DEFAULT_TTL = APP_CONSTANTS.IDEMPOTENCY_TTL; // 24 hours

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Check if this idempotency key has been processed before.
   * Returns the cached result if found, null if not.
   */
  async getResult<T>(idempotencyKey: string): Promise<T | null> {
    const key = this.buildKey(idempotencyKey);
    const raw = await this.redis.get(key);

    if (!raw) return null;

    try {
      const record = JSON.parse(raw) as IdempotencyRecord<T>;
      return record.result;
    } catch {
      // Corrupted cache — treat as cache miss
      this.logger.warn(`Corrupted idempotency record for key: ${idempotencyKey}`);
      return null;
    }
  }

  /**
   * Store the result of a processed request.
   * Uses SETEX for atomic set+expire.
   */
  async storeResult<T>(
    idempotencyKey: string,
    result: T,
    ttlSeconds = this.DEFAULT_TTL,
  ): Promise<void> {
    const key = this.buildKey(idempotencyKey);
    const record: IdempotencyRecord<T> = {
      result,
      processedAt: new Date().toISOString(),
      requestHash: this.hashKey(idempotencyKey),
    };

    await this.redis.set(key, JSON.stringify(record), ttlSeconds);
  }

  /**
   * Atomic check-and-set for distributed lock semantics.
   * Returns true if this instance "won" the right to process,
   * false if another instance is already processing this key.
   *
   * Uses SET NX (Set if Not eXists) — atomic in Redis.
   */
  async tryAcquireProcessingLock(idempotencyKey: string, ttlSeconds = 30): Promise<boolean> {
    const lockKey = `${this.PREFIX}lock:${idempotencyKey}`;
    const result = await this.redis.getClient().set(lockKey, '1', 'EX', ttlSeconds, 'NX');

    return result === 'OK';
  }

  async releaseLock(idempotencyKey: string): Promise<void> {
    const lockKey = `${this.PREFIX}lock:${idempotencyKey}`;
    await this.redis.del(lockKey);
  }

  /**
   * Idempotency wrapper — full flow in one call.
   * Handles: check → process → store with error safety.
   */
  async withIdempotency<T>(
    idempotencyKey: string,
    fn: () => Promise<T>,
    ttlSeconds = this.DEFAULT_TTL,
  ): Promise<{ result: T; wasIdempotent: boolean }> {
    // 1. Check existing
    const existing = await this.getResult<T>(idempotencyKey);
    if (existing !== null) {
      return { result: existing, wasIdempotent: true };
    }

    // 2. Acquire lock — prevent duplicate processing
    const acquired = await this.tryAcquireProcessingLock(idempotencyKey);
    if (!acquired) {
      // Another instance is processing — wait briefly and check again
      await this.sleep(200);
      const retryExisting = await this.getResult<T>(idempotencyKey);
      if (retryExisting !== null) {
        return { result: retryExisting, wasIdempotent: true };
      }
      // Still not processed — something went wrong, let this instance try
    }

    try {
      // 3. Process
      const result = await fn();

      // 4. Store result
      await this.storeResult(idempotencyKey, result, ttlSeconds);

      return { result, wasIdempotent: false };
    } finally {
      await this.releaseLock(idempotencyKey);
    }
  }

  private buildKey(idempotencyKey: string): string {
    // Sanitize key — prevent Redis key injection
    const sanitized = idempotencyKey.replace(/[^a-zA-Z0-9_\-:]/g, '');
    return `${this.PREFIX}${sanitized}`;
  }

  private hashKey(key: string): string {
    // Simple hash for audit — not for security
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
