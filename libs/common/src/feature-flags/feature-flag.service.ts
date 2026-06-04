/**
 * FeatureFlagService
 *
 * Evaluation is Redis-cached (5-second TTL) — negligible latency on hot paths.
 * Cache invalidated on every flag update.
 *
 * Rollout algorithm: deterministic hash so the same user always gets
 * the same outcome for a given flag.
 *   bucket = fnv32a(userId + flagKey) % 100
 *   feature on ↔ bucket < rolloutPercent
 *
 * FNV-32a chosen over Math.random() because it is:
 *   - Deterministic (reproducible without storage)
 *   - Fast (no crypto overhead)
 *   - Good distribution for IDs
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { Redis } from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { FeatureFlag } from './feature-flag.entity';

const CACHE_TTL = 5; // seconds — short TTL keeps flags near-real-time

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly env = process.env.NODE_ENV ?? 'production';

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly repo: Repository<FeatureFlag>,
    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  /** Primary API: should user X see feature Y? */
  async isEnabled(key: string, userId?: string, sellerId?: string): Promise<boolean> {
    const flag = await this.getFlag(key);
    if (!flag) return false;
    return this.evaluate(flag, userId, sellerId);
  }

  /** Bulk check — used by frontend /api/feature-flags endpoint */
  async getEnabledFlags(
    keys: string[],
    userId?: string,
    sellerId?: string,
  ): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    await Promise.all(
      keys.map(async (key) => {
        result[key] = await this.isEnabled(key, userId, sellerId);
      }),
    );
    return result;
  }

  /** Admin: list all flags with metadata */
  async findAll(): Promise<FeatureFlag[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  /** Admin: create or update a flag */
  async upsert(key: string, dto: Partial<FeatureFlag>): Promise<FeatureFlag> {
    await this.repo.upsert({ key, ...dto }, ['key']);
    await this.bust(key);
    return this.repo.findOneOrFail({ where: { key } });
  }

  /** Admin: delete (cleanup after experiments) */
  async remove(key: string): Promise<void> {
    await this.repo.delete({ key });
    await this.bust(key);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async getFlag(key: string): Promise<FeatureFlag | null> {
    const cacheKey = `hc:ff:${key}`;
    const cached = await this.redis.get(cacheKey);

    if (cached !== null) {
      return cached === 'null' ? null : (JSON.parse(cached) as FeatureFlag);
    }

    const flag = await this.repo.findOne({ where: { key } });
    await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(flag ?? null));
    return flag;
  }

  private async bust(key: string): Promise<void> {
    await this.redis.del(`hc:ff:${key}`);
  }

  private evaluate(flag: FeatureFlag, userId?: string, sellerId?: string): boolean {
    if (!flag.enabled) return false;

    // Environment gate
    if (flag.environments?.length && !flag.environments.includes(this.env)) {
      return false;
    }

    // Expired flags are silently disabled
    if (flag.expiresAt && new Date(flag.expiresAt) < new Date()) return false;

    // Explicit allowlists always win
    if (userId && flag.allowedUserIds?.includes(userId)) return true;
    if (sellerId && flag.allowedSellerIds?.includes(sellerId)) return true;

    // Percentage rollout (deterministic)
    if (flag.rolloutPercent < 100 && userId) {
      const bucket = this.fnv32a(userId + flag.key) % 100;
      return bucket < flag.rolloutPercent;
    }

    return flag.rolloutPercent > 0;
  }

  /** FNV-32a hash — fast, deterministic, good distribution */
  private fnv32a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0; // unsigned 32-bit
    }
    return hash;
  }
}
