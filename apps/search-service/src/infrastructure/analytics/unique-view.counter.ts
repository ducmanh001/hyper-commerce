/**
 * UniqueViewCounter — HyperLogLog applied to real unique product view counting
 *
 * PROBLEM:
 *   We want to show "X people viewed this product today".
 *   Naive: INCREMENT a Redis counter for every view.
 *   Problem: Same user reloads the page 10 times → counter inflated by 10×.
 *
 *   Better naive: Store a Redis Set of viewer IDs. SCARD for count.
 *   Problem: 100K viewers × 36 bytes (UUID) = 3.6MB per product per day.
 *   With 1M products × 365 days = impossible.
 *
 * SOLUTION: HyperLogLog
 *   A probabilistic data structure with remarkable properties:
 *   - Counts distinct elements with ~0.81% error (at precision=14)
 *   - Memory: constant 12KB regardless of cardinality (even for 1 billion items!)
 *   - Merging: two HLLs can be merged (union of their distinct element sets)
 *
 * HOW IT WORKS (simplified):
 *   For each element, hash it → observe the number of leading zeros in the hash.
 *   More leading zeros = rarer = higher estimate of cardinality.
 *   Uses many sub-estimators (registers) for accuracy.
 *   Final count = harmonic mean of all register estimates.
 *
 * ERROR TRADEOFF:
 *   precision=12 → 4096 registers → ~1.6% error → 40KB
 *   precision=14 → 16384 registers → ~0.81% error → 160KB
 *   precision=16 → 65536 registers → ~0.40% error → 640KB
 *
 * FOR PRODUCT VIEWS:
 *   "10,000 ± 80 people viewed" is completely fine.
 *   We don't need exact counts — approximate is sufficient.
 *
 * DAILY WINDOWS:
 *   HLL keys are namespaced by date → easy to query "views today", "views this week"
 *   by merging HLLs across multiple days.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { HyperLogLog } from '@hypercommerce/algorithms';
import type { RedisClientService } from '@hypercommerce/redis';
import type { AlgorithmConfigProps } from '@hypercommerce/common/config/algorithm.config';
import algorithmConfig from '@hypercommerce/common/config/algorithm.config';

const TTL_SECONDS = {
  daily: 25 * 3600, // 25 hours (a bit longer than 24h to handle timezone edge cases)
  weekly: 8 * 24 * 3600,
};

@Injectable()
export class UniqueViewCounter {
  private readonly logger = new Logger(UniqueViewCounter.name);

  /** In-process HLL instances (avoids Redis reads for every view event) */
  private readonly localCounters = new Map<string, HyperLogLog>();
  private flushTimer?: NodeJS.Timeout;
  private readonly FLUSH_INTERVAL_MS = 10_000; // Flush to Redis every 10s

  constructor(
    private readonly redis: RedisClientService,
    @Inject(algorithmConfig.KEY) private readonly config: AlgorithmConfigProps,
  ) {}

  /**
   * Record a product view.
   * Uses userId as the distinct element — deduplicates repeat views from same user.
   * Called from ProductViewController (or a Kafka consumer of product.viewed events).
   */
  async recordView(productId: string, userId: string): Promise<void> {
    const key = this.dailyKey(productId);
    let hll = this.localCounters.get(key);

    if (!hll) {
      // First view today — load existing HLL from Redis if any
      hll = (await this.loadFromRedis(key)) ?? new HyperLogLog(this.config.hyperLogLog.precision);
      this.localCounters.set(key, hll);
    }

    hll.add(userId);
    this.scheduleFlush(key);
  }

  /**
   * Get estimated unique viewer count for a product today.
   * Returns estimated count with confidence info for transparency.
   */
  async getUniqueViewCount(
    productId: string,
    period: 'today' | 'week' = 'today',
  ): Promise<{
    count: number;
    errorPercent: number;
  }> {
    const precision = this.config.hyperLogLog.precision;
    const errorPct = (1.04 / Math.sqrt(2 ** precision)) * 100;

    if (period === 'today') {
      const key = this.dailyKey(productId);
      const local = this.localCounters.get(key);

      if (local) {
        return { count: local.count(), errorPercent: errorPct };
      }

      const hll = await this.loadFromRedis(key);
      if (!hll) return { count: 0, errorPercent: errorPct };
      return { count: hll.count(), errorPercent: errorPct };
    }

    // Merge last 7 days
    const merged = new HyperLogLog(precision);
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10); // YYYY-MM-DD
    });

    const hlls = await Promise.all(
      dates.map((date) => this.loadFromRedis(this.keyForDate(productId, date))),
    );

    for (const hll of hlls) {
      if (hll) merged.merge(hll);
    }

    return { count: merged.count(), errorPercent: errorPct };
  }

  /**
   * Get top products by unique views today (for trending section).
   * Uses CountMinSketch (see TrendingTracker) for the ranking,
   * HLL here is for the accurate count display on product pages.
   */
  async getBulkCounts(productIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    await Promise.all(
      productIds.map(async (id) => {
        const { count } = await this.getUniqueViewCount(id);
        result.set(id, count);
      }),
    );

    return result;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private dailyKey(productId: string): string {
    return this.keyForDate(productId, new Date().toISOString().slice(0, 10));
  }

  private keyForDate(productId: string, date: string): string {
    return `hll:views:${date}:${productId}`;
  }

  private async loadFromRedis(key: string): Promise<HyperLogLog | null> {
    const buf = await this.redis.getBuffer(key);
    if (!buf || buf.length === 0) return null;
    try {
      return HyperLogLog.fromBuffer(buf, this.config.hyperLogLog.precision);
    } catch {
      return null;
    }
  }

  private scheduleFlush(key: string): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flushDirty(), this.FLUSH_INTERVAL_MS);
    }
  }

  private async flushDirty(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    const writes: Promise<void>[] = [];
    for (const [key, hll] of this.localCounters.entries()) {
      // Only flush today's counters
      if (key.includes(today)) {
        const buf = hll.toBuffer();
        writes.push(this.redis.setBuffer(key, buf, TTL_SECONDS.daily));
      }
    }
    await Promise.allSettled(writes);
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flushDirty();
    this.localCounters.clear();
  }
}
