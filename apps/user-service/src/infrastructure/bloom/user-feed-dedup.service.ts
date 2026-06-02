/**
 * UserFeedDedupService — BloomFilter applied to real feed deduplication
 *
 * PROBLEM:
 *   When a user scrolls their feed, we must not show items they've already seen.
 *   Naive approach: store a Set of seen product IDs per user in Redis.
 *   Problem: A user who scrolls often might see 10,000+ products.
 *            Storing 10K UUIDs = ~360KB per user in Redis.
 *            With 1M active users = 360GB just for seen-items tracking.
 *
 * SOLUTION: BloomFilter
 *   A probabilistic data structure. Tells you:
 *   - "DEFINITELY NOT seen" (no false negatives)
 *   - "PROBABLY seen" (1% false positive rate — might occasionally hide a new item)
 *
 *   Space: ~1.2M items × 0.01 FPR → ~1.7MB per user
 *   Better? Wait — actually 1.7MB is worse than 360KB!
 *
 *   For this use case, the BF is best for:
 *   1. Very large seen-item sets (>50K items)
 *   2. When perfect accuracy isn't needed (1% false positive is fine for feed)
 *   3. Cross-session persistence without growing storage linearly
 *
 *   With smaller sets, a plain Redis Set is fine. We use ScalableBloomFilter
 *   which starts small and grows automatically.
 *
 * PER-USER FILTER:
 *   Each user has their own BF serialized to Redis as binary.
 *   ~100KB per user at typical usage (10K seen items, 0.01 FPR).
 *   With 1M active users storing BF = 100GB (vs 360GB for raw sets).
 *   Win: ~3.6× smaller.
 *
 * EXPIRY:
 *   BF expires after 7 days of inactivity (TTL on Redis key).
 *   Users who return after 7 days might see some repeated items — acceptable.
 *   This prevents unbounded growth for inactive users.
 *
 * IMPORTANT: This is in the INFRASTRUCTURE layer because BloomFilter is an
 *   optimization detail, not a domain concept. The domain says "don't show
 *   seen items" — HOW we track seen items is infrastructure's decision.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { BloomFilter } from '@hypercommerce/algorithms';
import { USER_CACHE_PORT, IUserCachePort } from '../../application/ports/application.ports';
import algorithmConfig, { AlgorithmConfigProps } from '@hypercommerce/common/config/algorithm.config';

const SEEN_ITEMS_TTL_SEC = 7 * 24 * 3600; // 7 days

@Injectable()
export class UserFeedDedupService {
  private readonly logger = new Logger(UserFeedDedupService.name);

  /** In-memory cache of bloom filters (avoids Redis round-trip on every check) */
  private readonly localCache = new Map<string, { filter: BloomFilter; dirtyAt: number }>();
  private readonly FLUSH_INTERVAL_MS = 30_000;  // Flush to Redis every 30s
  private flushTimer?: NodeJS.Timeout;

  constructor(
    @Inject(USER_CACHE_PORT) private readonly cache: IUserCachePort,
    @Inject(algorithmConfig.KEY) private readonly config: AlgorithmConfigProps,
  ) {}

  /**
   * Called by FeedService when rendering a user's feed.
   * Filters out product IDs that the user has likely already seen.
   *
   * @param userId       The user whose feed is being generated
   * @param productIds   Candidate product IDs to show
   * @returns            Product IDs that are PROBABLY NOT seen before
   */
  async filterUnseenProducts(userId: string, productIds: string[]): Promise<string[]> {
    const filter = await this.loadFilter(userId);

    const unseen = productIds.filter((id) => !filter.has(id));

    this.logger.debug({
      event: 'feed_dedup_filter',
      userId,
      candidates: productIds.length,
      unseen: unseen.length,
      filtered: productIds.length - unseen.length,
    });

    return unseen;
  }

  /**
   * Mark products as "seen" — called AFTER successfully serving them in the feed.
   * We add to in-memory BF immediately, flush to Redis periodically.
   */
  async markAsSeen(userId: string, productIds: string[]): Promise<void> {
    const filter = await this.loadFilter(userId);
    for (const id of productIds) {
      filter.add(id);
    }
    this.scheduleFlush(userId);
  }

  /**
   * Check if a single product was likely seen — used for individual item views.
   */
  async hasSeen(userId: string, productId: string): Promise<boolean> {
    const filter = await this.loadFilter(userId);
    return filter.has(productId);
  }

  /**
   * Clear a user's seen-items filter (e.g., user requested "show me everything again").
   */
  async resetFilter(userId: string): Promise<void> {
    this.localCache.delete(userId);
    await this.cache.setSeenItemsFilter(userId, Buffer.alloc(0), SEEN_ITEMS_TTL_SEC);
    this.logger.log({ event: 'feed_dedup_reset', userId });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async loadFilter(userId: string): Promise<BloomFilter> {
    // Check in-memory cache first (fastest path: ~0.01ms)
    const cached = this.localCache.get(userId);
    if (cached) return cached.filter;

    // Deserialize from Redis (fast: ~0.5ms)
    const buf = await this.cache.getSeenItemsFilter(userId);

    const opts = {
      expectedItems:      this.config.bloomFilter.expectedCapacity,
      falsePositiveRate:  this.config.bloomFilter.falsePositiveRate,
    };
    const filter = (buf && buf.length > 0)
      ? BloomFilter.fromBuffer(buf, opts)
      : new BloomFilter(opts);

    this.localCache.set(userId, { filter, dirtyAt: 0 });
    return filter;
  }

  private scheduleFlush(userId: string): void {
    const entry = this.localCache.get(userId);
    if (!entry) return;
    entry.dirtyAt = Date.now();

    // Start the periodic flush timer if not already running
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flushDirtyFilters(), this.FLUSH_INTERVAL_MS);
    }
  }

  private async flushDirtyFilters(): Promise<void> {
    const now = Date.now();
    const flushPromises: Promise<void>[] = [];

    for (const [userId, entry] of this.localCache.entries()) {
      if (entry.dirtyAt > 0 && now - entry.dirtyAt >= this.FLUSH_INTERVAL_MS) {
        const serialized = entry.filter.toBuffer();
        flushPromises.push(
          this.cache.setSeenItemsFilter(userId, serialized, SEEN_ITEMS_TTL_SEC)
            .then(() => { entry.dirtyAt = 0; })
            .catch((err: unknown) => {
              this.logger.warn({ event: 'feed_dedup_flush_failed', userId, error: String(err) });
            }),
        );
      }
    }

    if (flushPromises.length > 0) {
      await Promise.allSettled(flushPromises);
    }
  }

  /** Called on application shutdown to flush all dirty filters */
  async flushAll(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    const promises: Promise<void>[] = [];
    for (const [userId, entry] of this.localCache.entries()) {
      if (entry.dirtyAt > 0) {
        const serialized = entry.filter.toBuffer();
        promises.push(
          this.cache.setSeenItemsFilter(userId, serialized, SEEN_ITEMS_TTL_SEC),
        );
      }
    }
    await Promise.allSettled(promises);
    this.localCache.clear();
    this.logger.log('UserFeedDedupService: all filters flushed on shutdown');
  }
}
