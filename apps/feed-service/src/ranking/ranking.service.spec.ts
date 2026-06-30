// ============================================================
// HYPERCOMMERCE — RankingService Unit Tests
// Pure function — no mocks needed (no external I/O in score()).
// ============================================================

import { RankingService } from './ranking.service';
import type { FeedEvent, UserContext } from './ranking.service';
import type { RankingWeights } from './ab-weight-resolver.service';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

const V1_WEIGHTS: RankingWeights = APP_CONSTANTS.FEED_RANK_WEIGHTS_V1;

function makeEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    postId: 'post-001',
    authorId: 'author-001',
    authorUsername: 'seller_a',
    postType: 'PRODUCT',
    contentPreview: 'Sample product',
    completionRate: 0.7,
    purchaseRate: 0.05,
    shareRate: 0.03,
    createdAt: new Date(), // just published → decay ≈ 1.0
    ...overrides,
  };
}

function makeContext(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'user-001',
    weights: V1_WEIGHTS,
    ...overrides,
  };
}

describe('RankingService', () => {
  let service: RankingService;

  beforeEach(() => {
    service = new RankingService();
  });

  // ── Happy path ──────────────────────────────────────────────

  describe('score()', () => {
    it('returns a non-negative score for a fresh post', () => {
      const result = service.score(makeEvent(), makeContext());
      expect(result.finalScore).toBeGreaterThan(0);
    });

    it('uses v1 weighted formula correctly', () => {
      const now = new Date();
      const event = makeEvent({
        completionRate: 1.0,
        purchaseRate: 1.0,
        shareRate: 1.0,
        createdAt: now,
      });
      const ctx = makeContext({ userEmbed: undefined }); // interest defaults to 0.5

      const result = service.score(event, ctx);
      const ageHours = 0; // brand new
      const decay = Math.exp(-0.1 * ageHours); // = 1.0
      const userInterest = 0.5; // neutral fallback

      const expected =
        1.0 * V1_WEIGHTS.completionRate +
        1.0 * V1_WEIGHTS.purchaseRate +
        userInterest * V1_WEIGHTS.userInterest +
        decay * V1_WEIGHTS.decay +
        1.0 * V1_WEIGHTS.shareRate;

      expect(result.finalScore).toBeCloseTo(expected, 3);
    });

    it('decayFactor approaches 0 for very old posts', () => {
      const oldDate = new Date(Date.now() - 7 * 24 * 3_600_000); // 7 days ago
      const result = service.score(makeEvent({ createdAt: oldDate }), makeContext());
      expect(result.components.decay).toBeLessThan(0.01);
    });

    it('decay at age=0 is 1.0', () => {
      const result = service.score(makeEvent({ createdAt: new Date() }), makeContext());
      expect(result.components.decay).toBeCloseTo(1.0, 2);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('clamps completionRate > 1 to 1.0', () => {
      const result = service.score(makeEvent({ completionRate: 2.5 }), makeContext());
      expect(result.components.completionRate).toBe(1.0);
    });

    it('clamps negative purchaseRate to 0', () => {
      const result = service.score(makeEvent({ purchaseRate: -0.5 }), makeContext());
      expect(result.components.purchaseRate).toBe(0);
    });

    it('returns neutral userInterest (0.5) when embeds absent', () => {
      const result = service.score(
        makeEvent({ contentEmbed: undefined }),
        makeContext({ userEmbed: undefined }),
      );
      expect(result.components.userInterest).toBe(0.5);
    });

    it('returns neutral userInterest when dimension mismatch', () => {
      const result = service.score(
        makeEvent({ contentEmbed: [1, 0] }),
        makeContext({ userEmbed: [1, 0, 0] }),
      );
      expect(result.components.userInterest).toBe(0.5);
    });

    it('all-zero signals still produces non-negative score (decay contributes)', () => {
      const result = service.score(
        makeEvent({ completionRate: 0, purchaseRate: 0, shareRate: 0, createdAt: new Date() }),
        makeContext({ userEmbed: undefined }),
      );
      expect(result.finalScore).toBeGreaterThan(0); // decay + neutral interest
    });
  });

  // ── User interest (dot product) ─────────────────────────────

  describe('userInterestScore', () => {
    it('identical vectors → userInterest = 1.0', () => {
      const embed = [1, 0, 0];
      const result = service.score(
        makeEvent({ contentEmbed: embed }),
        makeContext({ userEmbed: embed }),
      );
      expect(result.components.userInterest).toBeCloseTo(1.0, 3);
    });

    it('orthogonal vectors → userInterest = 0.5', () => {
      const result = service.score(
        makeEvent({ contentEmbed: [1, 0] }),
        makeContext({ userEmbed: [0, 1] }),
      );
      // cosine = 0 → maps to 0.5
      expect(result.components.userInterest).toBeCloseTo(0.5, 3);
    });

    it('opposite vectors → userInterest clipped to 0', () => {
      const result = service.score(
        makeEvent({ contentEmbed: [1, 0] }),
        makeContext({ userEmbed: [-1, 0] }),
      );
      // cosine = -1 → maps to 0
      expect(result.components.userInterest).toBeCloseTo(0, 3);
    });
  });

  // ── Business boosts ─────────────────────────────────────────

  describe('business boosts', () => {
    it('sponsored post receives ×1.5 boost', () => {
      const base = service.score(makeEvent(), makeContext());
      const boosted = service.score(makeEvent({ isSponsored: true }), makeContext());
      expect(boosted.finalScore).toBeCloseTo(base.finalScore * 1.5, 3);
    });

    it('flash-sale post receives ×1.3 boost', () => {
      const base = service.score(makeEvent(), makeContext());
      const boosted = service.score(makeEvent({ hasFlashSale: true }), makeContext());
      expect(boosted.finalScore).toBeCloseTo(base.finalScore * 1.3, 3);
    });

    it('sponsored + flash-sale stacks to ×1.95', () => {
      const base = service.score(makeEvent(), makeContext());
      const boosted = service.score(
        makeEvent({ isSponsored: true, hasFlashSale: true }),
        makeContext(),
      );
      expect(boosted.finalScore).toBeCloseTo(base.finalScore * 1.5 * 1.3, 3);
    });

    it('sellerTrustScore=0 is clamped to 0.5 multiplier', () => {
      const base = service.score(makeEvent({ sellerTrustScore: 1.0 }), makeContext());
      const low = service.score(makeEvent({ sellerTrustScore: 0 }), makeContext());
      expect(low.finalScore).toBeCloseTo(base.finalScore * 0.5, 3);
    });

    it('sellerTrustScore=1.0 does not change base score', () => {
      const base = service.score(makeEvent({ sellerTrustScore: 1.0 }), makeContext());
      const neutral = service.score(makeEvent(), makeContext()); // default trust = 1.0
      expect(base.finalScore).toBeCloseTo(neutral.finalScore, 6);
    });

    it('sellerTrustScore=1.5 is clamped to 1.0 multiplier', () => {
      const base = service.score(makeEvent({ sellerTrustScore: 1.0 }), makeContext());
      const excess = service.score(makeEvent({ sellerTrustScore: 1.5 }), makeContext());
      expect(excess.finalScore).toBeCloseTo(base.finalScore, 3);
    });
  });

  // ── scoreAll() ──────────────────────────────────────────────

  describe('scoreAll()', () => {
    it('scores every event in the list', () => {
      const events = [makeEvent({ postId: 'a' }), makeEvent({ postId: 'b' })];
      const results = service.scoreAll(events, makeContext());
      expect(results).toHaveLength(2);
      expect(results[0].postId).toBe('a');
      expect(results[1].postId).toBe('b');
    });

    it('returns empty array for empty input', () => {
      expect(service.scoreAll([], makeContext())).toEqual([]);
    });

    it('higher completionRate → higher score (all else equal)', () => {
      const low = service.score(makeEvent({ completionRate: 0.1 }), makeContext());
      const high = service.score(makeEvent({ completionRate: 0.9 }), makeContext());
      expect(high.finalScore).toBeGreaterThan(low.finalScore);
    });
  });
});
