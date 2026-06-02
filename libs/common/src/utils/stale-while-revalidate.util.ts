// ============================================================
// HYPERCOMMERCE — Stale-While-Revalidate (SWR) Cache
//
// WHY SWR?
// Standard cache-aside pattern:
//   miss → fetch → return  (cold start adds latency)
//   hit → return           (fast)
//   expired → block → fetch → return  (PROBLEM: thundering herd)
//
// Thundering herd: when many users hit an expired key simultaneously,
// all trigger DB fetches at once → DB spike → potential cascade failure.
//
// SWR solves this:
//   hit (fresh) → return immediately
//   hit (stale but within grace period) → return STALE IMMEDIATELY
//                                       + trigger background refresh
//   miss or expired → fetch synchronously
//
// RESULT:
// - Zero latency degradation on hot paths
// - DB never gets thundering herds
// - Data is at most (stale TTL) seconds out of date — acceptable for
//   most reads (user profiles, product listings, seller stats)
//
// WHERE NOT TO USE:
// - Payment status (must be real-time)
// - Inventory counts (SWR could show wrong stock)
// - Session tokens (security-sensitive)
//
// IMPLEMENTATION:
// Two TTLs per key:
// - freshTtl:  serve from cache without any DB check
// - staleTtl:  serve from cache AND trigger background refresh
// - After staleTtl: synchronous fetch (normal cache miss)
// ============================================================

import { Logger } from '@nestjs/common';
import { RedisClientService } from '@hypercommerce/redis';

export interface SWROptions {
  /** Seconds to serve fresh (no revalidation needed) */
  freshTtlSeconds: number;
  /** Seconds to serve stale while refreshing in background */
  staleTtlSeconds: number;
  /** Unique key prefix for Redis */
  keyPrefix?: string;
}

interface SWRRecord<T> {
  value: T;
  storedAt: number;    // Unix timestamp ms
  freshUntil: number;  // Unix timestamp ms
  staleUntil: number;  // Unix timestamp ms
}

const logger = new Logger('SWRCache');

/**
 * Generic SWR cache wrapper.
 *
 * Usage:
 * ```ts
 * const swr = new StaleWhileRevalidateCache(redis);
 * const profile = await swr.get(
 *   `user:${userId}`,
 *   () => this.db.findUser(userId),
 *   { freshTtlSeconds: 60, staleTtlSeconds: 300 },
 * );
 * ```
 */
export class StaleWhileRevalidateCache {
  private readonly refreshing = new Set<string>();  // in-process dedup

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Get a value, using stale-while-revalidate semantics.
   *
   * @param key       Redis key
   * @param fetcher   Async function to refresh the value
   * @param options   TTL configuration
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: SWROptions,
  ): Promise<T> {
    const fullKey = `${options.keyPrefix ?? 'swr:'}${key}`;
    const now = Date.now();

    // ── 1. Check cache ────────────────────────────────────
    const cached = await this.redis.get(fullKey);

    if (cached) {
      let record: SWRRecord<T>;
      try {
        record = JSON.parse(cached) as SWRRecord<T>;
      } catch {
        // Corrupted cache — treat as miss
        await this.redis.del(fullKey);
        return this.fetchAndStore(key, fullKey, fetcher, options);
      }

      // FRESH: return immediately, no DB check
      if (now < record.freshUntil) {
        return record.value;
      }

      // STALE: return stale value immediately, refresh in background
      if (now < record.staleUntil) {
        this.revalidateInBackground(key, fullKey, fetcher, options);
        return record.value;
      }
    }

    // ── 2. Cache miss or fully expired → synchronous fetch ──
    return this.fetchAndStore(key, fullKey, fetcher, options);
  }

  /**
   * Explicitly invalidate a key (e.g., on write operations).
   */
  async invalidate(key: string, options: Pick<SWROptions, 'keyPrefix'>): Promise<void> {
    const fullKey = `${options.keyPrefix ?? 'swr:'}${key}`;
    await this.redis.del(fullKey);
  }

  /**
   * Write-through: update cache immediately on write.
   * Prevents stale reads right after an update.
   */
  async set<T>(
    key: string,
    value: T,
    options: SWROptions,
  ): Promise<void> {
    const fullKey = `${options.keyPrefix ?? 'swr:'}${key}`;
    const now = Date.now();

    const record: SWRRecord<T> = {
      value,
      storedAt: now,
      freshUntil: now + options.freshTtlSeconds * 1000,
      staleUntil: now + options.staleTtlSeconds * 1000,
    };

    await this.redis.set(fullKey, JSON.stringify(record), options.staleTtlSeconds);
  }

  // ── Private ───────────────────────────────────────────────

  private async fetchAndStore<T>(
    key: string,
    fullKey: string,
    fetcher: () => Promise<T>,
    options: SWROptions,
  ): Promise<T> {
    const value = await fetcher();
    await this.set(key, value, options);
    return value;
  }

  private revalidateInBackground<T>(
    key: string,
    fullKey: string,
    fetcher: () => Promise<T>,
    options: SWROptions,
  ): void {
    // Dedup: only one refresh per key at a time
    if (this.refreshing.has(fullKey)) return;
    this.refreshing.add(fullKey);

    this.fetchAndStore(key, fullKey, fetcher, options)
      .catch((err) =>
        logger.warn(`SWR background refresh failed for ${key}: ${String(err)}`),
      )
      .finally(() => this.refreshing.delete(fullKey));
  }
}

// ── Decorator for NestJS services ─────────────────────────────
/**
 * @SWRCached decorator — wraps a method with SWR caching.
 *
 * Usage:
 * ```ts
 * @SWRCached({ freshTtlSeconds: 60, staleTtlSeconds: 300, keyPrefix: 'user:' })
 * async getUserProfile(userId: string): Promise<UserProfile> { ... }
 * ```
 *
 * Note: First parameter is used as the cache key.
 */
export function SWRCached(options: SWROptions & { redis?: RedisClientService }) {
  return function (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (this: { _swrCache?: StaleWhileRevalidateCache; redis?: RedisClientService }, ...args: unknown[]) {
      const redisClient = options.redis ?? this.redis;
      if (!redisClient) {
        // No Redis client — skip caching, call original
        return original.apply(this, args);
      }

      const cache = this._swrCache ?? (this._swrCache = new StaleWhileRevalidateCache(redisClient));
      const key = String(args[0] ?? 'default');

      return cache.get(key, () => original.apply(this, args) as Promise<unknown>, options);
    };

    return descriptor;
  };
}
