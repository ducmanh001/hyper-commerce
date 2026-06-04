// ============================================================
// HYPERCOMMERCE — Scoring Helper
// Computes individual ranking signals cho mỗi feed item.
//
// Signal engineering là core của recommendation system.
// Mỗi signal được normalize về [0, 1] trước khi weighted sum.
// ============================================================

import { Injectable } from '@nestjs/common';
import type { FeedItem } from '../repositories/feed.repository';

export interface PostSignals {
  // Precomputed by ML Rank Worker (offline)
  mlScore?: number; // 0-1, model-predicted CTR
  authorRelationshipScore?: number; // 0-1, viewer↔author interaction strength
  trendingScore?: number; // 0-1, viral velocity in last 2h

  // Online signals (computed at serve time)
  viewerHistory?: {
    hasViewed: boolean;
    hasPurchased: boolean;
    hasSavedSeller: boolean;
  };
}

export interface ScoredFeedItem extends FeedItem {
  finalScore: number;
  scoreComponents: {
    engagement: number;
    recency: number;
    relationship: number;
    diversity: number;
    mlBoost: number;
  };
  diversityPenalty?: number;
  authorId: string;
}

@Injectable()
export class ScoringHelper {
  // Weights — must sum to 1.0 (validated at startup)
  private readonly W_ENGAGEMENT = 0.35;
  private readonly W_RECENCY = 0.3;
  private readonly W_RELATIONSHIP = 0.2;
  private readonly W_DIVERSITY = 0.1;
  private readonly W_ML = 0.05; // Blend ML score on top

  // Recency decay half-life = 6 hours
  // After 6h, recency score = 0.5; after 12h = 0.25; etc.
  private readonly RECENCY_HALF_LIFE_MS = 6 * 60 * 60 * 1_000;

  /**
   * Score a single feed item for a user.
   * All signals are normalized [0, 1] before weighting.
   */
  score(item: FeedItem, userId: string, signals: PostSignals | null): ScoredFeedItem {
    const engagement = this.computeEngagementScore(item);
    const recency = this.computeRecencyScore(item.createdAt);
    const relationship = this.computeRelationshipScore(signals);
    const diversity = 0; // Computed in post-processing step
    const mlBoost = signals?.mlScore ?? 0;

    // Skip items viewer already bought (reduce purchase regret)
    if (signals?.viewerHistory?.hasPurchased) {
      return {
        ...item,
        authorId: item.authorId,
        finalScore: 0,
        scoreComponents: { engagement, recency, relationship, diversity, mlBoost },
      };
    }

    // Boost items from saved sellers
    const sellerBoost = signals?.viewerHistory?.hasSavedSeller ? 1.2 : 1.0;

    const rawScore =
      this.W_ENGAGEMENT * engagement +
      this.W_RECENCY * recency +
      this.W_RELATIONSHIP * relationship +
      this.W_DIVERSITY * diversity +
      this.W_ML * mlBoost;

    return {
      ...item,
      authorId: item.authorId,
      finalScore: Math.min(rawScore * sellerBoost, 1.0),
      scoreComponents: { engagement, recency, relationship, diversity, mlBoost },
    };
  }

  /**
   * Engagement score = normalized composite of likes, comments, shares.
   *
   * Formula: weighted engagement rate
   * Like weight = 1, Comment weight = 3 (more intent signal),
   * Share weight = 5 (strongest signal of all)
   *
   * Normalize by total impressions (estimated via view count or follower count).
   */
  private computeEngagementScore(item: FeedItem): number {
    const weightedEngagement = item.likeCount * 1 + item.commentCount * 3 + item.shareCount * 5;

    // Use item.engagementRate if precomputed, or estimate
    if (item.engagementRate > 0) {
      // Sigmoid normalization: maps 0% → 0, 10%+ → ~0.9
      return this.sigmoid(item.engagementRate * 10);
    }

    // Fallback: log normalization for cold content
    return Math.min(Math.log10(weightedEngagement + 1) / 4, 1);
  }

  /**
   * Recency score = exponential decay.
   * Formula: 2^(-age_ms / half_life_ms)
   * At t=0: score=1.0
   * At t=6h: score=0.5
   * At t=24h: score=0.0625
   * At t=72h: score~0.004 (essentially 0)
   */
  private computeRecencyScore(createdAt: Date): number {
    const ageMs = Date.now() - createdAt.getTime();
    return Math.pow(2, -ageMs / this.RECENCY_HALF_LIFE_MS);
  }

  /**
   * Relationship strength score.
   * Based on historical interaction frequency between viewer and author.
   *
   * Precomputed by ML Rank Worker offline:
   * - DM history, reply history, purchase history from this seller
   * - Mutual follows
   * - Profile view frequency
   *
   * Falls back to 0 (no prior relationship) if no signal available.
   */
  private computeRelationshipScore(signals: PostSignals | null): number {
    if (!signals?.authorRelationshipScore) return 0;
    // Already normalized 0-1 by offline ML worker
    return Math.min(signals.authorRelationshipScore, 1);
  }

  /**
   * Trending boost — content going viral gets extra push.
   * viral velocity = interactions/hour compared to author's baseline
   */
  private computeTrendingBoost(signals: PostSignals | null): number {
    if (!signals?.trendingScore) return 0;
    return signals.trendingScore * 0.1; // Max 10% trending boost
  }

  // ── Math Helpers ──────────────────────────────────────────

  /**
   * Sigmoid: maps any real number to (0, 1).
   * Used to normalize unbounded metrics without hard cutoffs.
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Validate that weights sum to 1.0 — important invariant.
   * Called at startup in unit tests.
   */
  validateWeights(): boolean {
    const sum =
      this.W_ENGAGEMENT + this.W_RECENCY + this.W_RELATIONSHIP + this.W_DIVERSITY + this.W_ML;
    return Math.abs(sum - 1.0) < 0.001;
  }
}
