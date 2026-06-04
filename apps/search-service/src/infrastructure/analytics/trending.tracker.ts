/**
 * TrendingTracker — CountMinSketch applied to real trending product tracking
 *
 * PROBLEM:
 *   "Show top 100 trending products right now."
 *   We receive millions of product view/click/purchase events per minute.
 *   We can't store a full frequency map (productId → count) in memory at scale.
 *
 * ALGORITHM: CountMinSketch (CMS)
 *
 *   A probabilistic frequency table:
 *   - d hash functions × w buckets each
 *   - For event(x): increment cms[h_i(x)] for all i
 *   - To query freq(x): take min across all rows → cms guarantees NO undercount
 *
 *   Space: d × w integers (e.g., 5 × 2000 × 4 bytes = 40KB, fixed regardless of events)
 *   Error: frequency overestimated by at most ε × n with probability (1 - δ)
 *     where ε = e/w, δ = e^(-d), n = total events
 *
 *   With d=5, w=2000: ε ≈ 0.0014 (0.14% error per item), δ = 0.0067 (99.3% confidence)
 *
 * WHY CMS OVER A HASH MAP:
 *   Hash map: O(unique products) space. If 1M products → 1M entries.
 *   CMS: O(d × w) = constant 40KB. Works for any number of products.
 *
 * TOP-K WITH CMS:
 *   CMS gives per-item frequency estimates, but doesn't tell you WHICH items are top-K.
 *   We use a min-heap of size K alongside CMS.
 *   When CMS estimate for an item exceeds the heap minimum, we update the heap.
 *   Result: approximate top-K with ~2× CMS error.
 *
 * WINDOWED TRENDING:
 *   CMS doesn't have built-in time windows.
 *   We use a "rotating" approach: two CMS instances (current + previous window).
 *   Every WINDOW_MINUTES, rotate: previous = current, current = new empty CMS.
 *   Trending score = 0.7 × current + 0.3 × previous (exponential decay).
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { CountMinSketch } from '@hypercommerce/algorithms';
import type { RedisClientService } from '@hypercommerce/redis';
import type { AlgorithmConfigProps } from '@hypercommerce/common/config/algorithm.config';
import algorithmConfig from '@hypercommerce/common/config/algorithm.config';

const WINDOW_MINUTES = 15; // Rotate every 15 minutes
const DECAY_CURRENT = 0.7; // Current window weight
const DECAY_PREVIOUS = 0.3; // Previous window weight

export interface TrendingItem {
  productId: string;
  score: number; // Weighted trending score
  estimatedCount: number; // Approximate view/click count
}

@Injectable()
export class TrendingTracker {
  private readonly logger = new Logger(TrendingTracker.name);

  private currentCms: CountMinSketch;
  private previousCms: CountMinSketch;
  private topKHeap: Map<string, number>; // productId → score

  private readonly WINDOW_MS: number;
  private windowTimer?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisClientService,
    @Inject(algorithmConfig.KEY) private readonly config: AlgorithmConfigProps,
  ) {
    const { width, depth, topKWindow } = config.countMinSketch;
    this.currentCms = new CountMinSketch(width, depth);
    this.previousCms = new CountMinSketch(width, depth);
    this.topKHeap = new Map();
    this.WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
  }

  /**
   * Record a product interaction event (view, click, purchase).
   * Different events have different weights for trending score.
   *
   * Weight strategy:
   *   view:     1 point  (lowest signal)
   *   click:    3 points (stronger intent)
   *   add_cart: 5 points
   *   purchase: 10 points (strongest signal)
   */
  track(productId: string, eventType: 'view' | 'click' | 'add_cart' | 'purchase'): void {
    const WEIGHT: Record<typeof eventType, number> = {
      view: 1,
      click: 3,
      add_cart: 5,
      purchase: 10,
    };

    const weight = WEIGHT[eventType];
    this.currentCms.increment(productId, weight);

    // Update top-K heap
    const currentScore = this.currentCms.query(productId);
    const prevScore = this.previousCms.query(productId);
    const trendScore = DECAY_CURRENT * currentScore + DECAY_PREVIOUS * prevScore;

    this.topKHeap.set(productId, trendScore);

    // Evict if heap exceeds 2× topK (to avoid unbounded growth)
    const maxK = this.config.countMinSketch.topKWindow * 2;
    if (this.topKHeap.size > maxK) {
      this.evictBottomHalf();
    }
  }

  /**
   * Get top K trending products right now.
   * Returns sorted by trending score descending.
   */
  getTopK(k?: number): TrendingItem[] {
    const limit = k ?? this.config.countMinSketch.topKWindow;

    return Array.from(this.topKHeap.entries())
      .map(([productId, score]) => ({
        productId,
        score,
        estimatedCount: this.currentCms.query(productId),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Trending score for a specific product.
   * Used in search ranking to boost trending items.
   */
  getTrendingScore(productId: string): number {
    const current = this.currentCms.query(productId);
    const previous = this.previousCms.query(productId);
    return DECAY_CURRENT * current + DECAY_PREVIOUS * previous;
  }

  /** Normalize trending score to [0, 1] for use as a ranking feature */
  getNormalizedTrendingScore(productId: string): number {
    const score = this.getTrendingScore(productId);
    const topItem = this.getTopK(1)[0];
    if (!topItem || topItem.score === 0) return 0;
    return Math.min(score / topItem.score, 1.0);
  }

  startWindowRotation(): void {
    this.windowTimer = setInterval(() => this.rotateWindow(), this.WINDOW_MS);
    this.logger.log(`Trending window rotation started (every ${WINDOW_MINUTES}min)`);
  }

  stopWindowRotation(): void {
    if (this.windowTimer) {
      clearInterval(this.windowTimer);
      this.windowTimer = undefined;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private rotateWindow(): void {
    this.previousCms = this.currentCms;
    this.currentCms = new CountMinSketch(
      this.config.countMinSketch.width,
      this.config.countMinSketch.depth,
    );
    this.logger.debug('Trending window rotated');
  }

  private evictBottomHalf(): void {
    const sorted = Array.from(this.topKHeap.entries()).sort((a, b) => b[1] - a[1]);
    const keepN = this.config.countMinSketch.topKWindow;
    const toKeep = new Map(sorted.slice(0, keepN));
    this.topKHeap = toKeep;
  }
}
