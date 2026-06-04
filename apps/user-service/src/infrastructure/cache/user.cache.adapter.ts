/**
 * UserCacheAdapter — Redis-backed cache implementing IUserCachePort
 *
 * WHY ADAPTER (not direct Redis use in handlers):
 *   Application layer calls cache.getProfile() — it doesn't know about Redis keys,
 *   serialization format, or TTL strategies.
 *   If we switch from Redis to Memcached, only this adapter changes.
 *
 * KEY DESIGN:
 *   user:profile:{userId}        — JSON snapshot, TTL 5min
 *   user:seen:{userId}           — Binary BloomFilter, TTL 7 days
 *   user:verify:{token}          — UserId string, TTL configurable
 *
 *   Using namespaced keys avoids collisions across services
 *   (since multiple services might share a Redis cluster).
 *
 * SERIALIZATION:
 *   Profiles: JSON (human-readable, easy to inspect in Redis CLI)
 *   BloomFilters: Binary (compact, no JSON overhead for large bit arrays)
 */
import { Injectable } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import type { IUserCachePort } from '../../application/ports/application.ports';

const KEY = {
  profile: (id: string) => `user:profile:${id}`,
  seenItems: (id: string) => `user:seen:${id}`,
  verifyToken: (token: string) => `user:verify:${token}`,
} as const;

@Injectable()
export class UserCacheAdapter implements IUserCachePort {
  constructor(private readonly redis: RedisClientService) {}

  async getProfile(userId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(KEY.profile(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async setProfile(
    userId: string,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(KEY.profile(userId), JSON.stringify(data), ttlSeconds);
  }

  async invalidateProfile(userId: string): Promise<void> {
    await this.redis.del(KEY.profile(userId));
  }

  async getSeenItemsFilter(userId: string): Promise<Buffer | null> {
    const raw = await this.redis.getBuffer(KEY.seenItems(userId));
    return raw ?? null;
  }

  async setSeenItemsFilter(
    userId: string,
    filterBuffer: Buffer,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.setBuffer(KEY.seenItems(userId), filterBuffer, ttlSeconds);
  }

  async setVerificationToken(token: string, userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(KEY.verifyToken(token), userId, ttlSeconds);
  }

  async getVerificationToken(token: string): Promise<string | null> {
    return this.redis.get(KEY.verifyToken(token));
  }

  async deleteVerificationToken(token: string): Promise<void> {
    await this.redis.del(KEY.verifyToken(token));
  }
}
