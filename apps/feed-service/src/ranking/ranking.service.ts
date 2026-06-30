// ============================================================
// HYPERCOMMERCE — Ranking Service (v1 Linear Formula)
// Pure scoring function — NO Redis/Cassandra I/O inside score().
// All external data is pre-loaded and passed via userContext.
//
// Formula (from social.agent.md):
//   baseScore = completionRate×W.completionRate
//             + purchaseRate×W.purchaseRate
//             + userInterestScore×W.userInterest
//             + decayFactor×W.decay
//             + shareRate×W.shareRate
//
//   decayFactor = e^(-0.1 × ageHours)
//   userInterestScore = dot(userEmbed, contentEmbed)  — clipped to [0, 1]
//
// Business boosts (applied after weighted sum):
//   isSponsored   → ×1.5
//   hasFlashSale  → ×1.3
//   sellerTrust   → ×sellerTrustScore (0–1 multiplier)
//
// Do NOT import Redis/DB here — keeps function unit-testable.
// ============================================================

import { Injectable } from '@nestjs/common';
import type { RankingWeights } from './ab-weight-resolver.service';

// ── Input types ───────────────────────────────────────────────

export interface FeedEvent {
  postId: string;
  authorId: string;
  authorUsername: string;
  postType: 'VIDEO' | 'IMAGE' | 'TEXT' | 'LIVE' | 'PRODUCT';
  contentPreview: string;
  mediaUrl?: string;
  productId?: string;

  // Engagement signals (normalised [0, 1] or raw counts)
  completionRate: number; // video watch completion (0–1)
  purchaseRate: number; // click-to-purchase rate (0–1)
  shareRate: number; // share rate (0–1)

  // Content vector (optional — 768-dim from text-embedding-3-large)
  contentEmbed?: number[];

  // Business boosts
  isSponsored?: boolean;
  hasFlashSale?: boolean;
  sellerTrustScore?: number; // 0–1 from user-service, default 1.0

  // Timestamps
  createdAt: Date;
}

export interface UserContext {
  userId: string;
  userEmbed?: number[]; // 768-dim from Redis user:embed:{userId}
  weights: RankingWeights; // resolved by AbWeightResolverService
}

export interface ScoringResult {
  postId: string;
  finalScore: number;
  components: {
    completionRate: number;
    purchaseRate: number;
    userInterest: number; // dot-product similarity, clipped [0,1]
    decay: number; // e^(-0.1 × ageHours), [0,1]
    shareRate: number;
    businessBoost: number; // multiplicative factor applied
  };
  variant: 'v1' | 'v2'; // which weight set was used
}

// ── Service ───────────────────────────────────────────────────

@Injectable()
export class RankingService {
  /**
   * Score a single feed event for a user.
   * Pure function — deterministic given the same inputs.
   * Suitable for unit testing without mocks.
   *
   * @param event   Post with engagement signals and content vector
   * @param context User context including embed and weight set
   * @returns       Scoring result with final score and breakdown
   */
  score(event: FeedEvent, context: UserContext): ScoringResult {
    const { weights } = context;

    // 1. Compute decay factor: e^(-0.1 × ageHours)
    const ageHours = (Date.now() - event.createdAt.getTime()) / 3_600_000;
    const decay = Math.exp(-0.1 * ageHours);

    // 2. Compute user-interest via cosine-like dot product
    const userInterest = this.computeUserInterest(event.contentEmbed, context.userEmbed);

    // 3. Clamp engagement signals to [0, 1]
    const completionRate = Math.min(Math.max(event.completionRate, 0), 1);
    const purchaseRate = Math.min(Math.max(event.purchaseRate, 0), 1);
    const shareRate = Math.min(Math.max(event.shareRate, 0), 1);

    // 4. Weighted linear sum (v1 formula)
    const baseScore =
      completionRate * weights.completionRate +
      purchaseRate * weights.purchaseRate +
      userInterest * weights.userInterest +
      decay * weights.decay +
      shareRate * weights.shareRate;

    // 5. Business boosts (multiplicative)
    const businessBoost = this.computeBusinessBoost(event);
    const finalScore = baseScore * businessBoost;

    return {
      postId: event.postId,
      finalScore,
      components: {
        completionRate,
        purchaseRate,
        userInterest,
        decay,
        shareRate,
        businessBoost,
      },
      variant: 'v1', // caller passes weights — variant label comes from resolver
    };
  }

  /**
   * Score multiple events in batch. Useful for sorting a feed page.
   */
  scoreAll(events: FeedEvent[], context: UserContext): ScoringResult[] {
    return events.map((e) => this.score(e, context));
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * userInterestScore = dot(userEmbed, contentEmbed) / (||u|| × ||c||)
   * Clipped to [0, 1] (negative similarity → 0, not a penalty).
   *
   * Falls back to 0.5 (neutral) if either vector is missing — ensures
   * content without embeddings is not deprioritised unfairly.
   */
  private computeUserInterest(
    contentEmbed: number[] | undefined,
    userEmbed: number[] | undefined,
  ): number {
    if (!contentEmbed?.length || !userEmbed?.length) {
      return 0.5; // neutral fallback
    }

    if (contentEmbed.length !== userEmbed.length) {
      return 0.5; // dimension mismatch — safe fallback
    }

    let dot = 0;
    let normU = 0;
    let normC = 0;

    for (let i = 0; i < userEmbed.length; i++) {
      dot += userEmbed[i] * contentEmbed[i];
      normU += userEmbed[i] ** 2;
      normC += contentEmbed[i] ** 2;
    }

    const denom = Math.sqrt(normU) * Math.sqrt(normC);
    if (denom === 0) return 0.5;

    // Map cosine similarity from [-1,1] to [0,1]
    const cosine = dot / denom;
    return Math.max(0, (cosine + 1) / 2);
  }

  /**
   * Business boost multiplier.
   * Boosts are stackable — sponsored flash-sale content gets ×1.5×1.3 = ×1.95.
   * sellerTrustScore defaults to 1.0 if absent.
   */
  private computeBusinessBoost(event: FeedEvent): number {
    let boost = 1.0;

    if (event.isSponsored) boost *= 1.5;
    if (event.hasFlashSale) boost *= 1.3;

    const trust = event.sellerTrustScore ?? 1.0;
    // Clamp trust to [0.5, 1.0] — never completely silence low-trust sellers
    boost *= Math.min(Math.max(trust, 0.5), 1.0);

    return boost;
  }
}
