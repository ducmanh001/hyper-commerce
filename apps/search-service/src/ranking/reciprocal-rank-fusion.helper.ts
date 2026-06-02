// ============================================================
// HYPERCOMMERCE — Reciprocal Rank Fusion (RRF) Helper
// Merges BM25 keyword results + kNN vector results.
//
// Tại sao không cộng score thẳng?
// BM25 score range: 0 → ∞ (unbounded, depends on doc frequency)
// Vector cosine similarity: -1 → 1 (bounded, normalized)
// Cộng trực tiếp → BM25 sẽ dominate hoàn toàn.
//
// RRF chỉ dùng RANK, không dùng score → unit-agnostic.
// Formula: RRF(d) = Σ 1/(k + rank_i(d))
// k = 60 (prevents rank 1 from dominating)
// ============================================================

export interface RankedResult {
  id: string;                    // Document ID
  score: number;                 // Original score from this ranker
  rank: number;                  // 1-based rank position
  metadata?: Record<string, unknown>;
}

export interface FusedResult {
  id: string;
  rrfScore: number;
  bm25Rank?: number;
  vectorRank?: number;
  bm25Score?: number;
  vectorScore?: number;
}

/**
 * Reciprocal Rank Fusion — merges multiple ranked lists.
 *
 * Algorithm:
 * 1. For each document d and each ranked list L:
 *    contribution += 1 / (k + rank_L(d))
 * 2. Sum all contributions
 * 3. Sort by total RRF score DESC
 *
 * Key properties:
 * - Not sensitive to score distribution differences between lists
 * - Consistently outperforms linear combination in IR benchmarks
 * - Simple, efficient: O(n×m) where n=docs, m=lists
 */
export class ReciprocalRankFusionHelper {
  private readonly k: number;

  constructor(k = 60) {
    // k=60 is the empirically optimal value (Cormack, Clarke, Buettcher 2009)
    // Higher k: more weight to lower-ranked items
    // Lower k: more weight to top-ranked items
    this.k = k;
  }

  /**
   * Fuse multiple ranked lists using RRF.
   * Lists can have different sizes — handles gracefully.
   */
  fuse(rankedLists: RankedResult[][]): FusedResult[] {
    const scores = new Map<string, {
      rrfScore: number;
      ranks: number[];
      origScores: number[];
    }>();

    for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
      const list = rankedLists[listIdx];

      for (let rank = 0; rank < list.length; rank++) {
        const item = list[rank];
        const contribution = 1 / (this.k + rank + 1); // +1 for 1-based ranking

        const existing = scores.get(item.id) ?? {
          rrfScore: 0,
          ranks: new Array(rankedLists.length).fill(-1),
          origScores: new Array(rankedLists.length).fill(0),
        };

        existing.rrfScore += contribution;
        existing.ranks[listIdx] = rank + 1;
        existing.origScores[listIdx] = item.score;

        scores.set(item.id, existing);
      }
    }

    const fused: FusedResult[] = [];

    for (const [id, data] of scores) {
      fused.push({
        id,
        rrfScore: data.rrfScore,
        bm25Rank: data.ranks[0] > 0 ? data.ranks[0] : undefined,
        vectorRank: data.ranks[1] > 0 ? data.ranks[1] : undefined,
        bm25Score: data.origScores[0] || undefined,
        vectorScore: data.origScores[1] || undefined,
      });
    }

    // Sort by RRF score DESC
    return fused.sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Fuse with weights — allows boosting one list over another.
   * Weighted RRF: contribution *= weight
   *
   * Use case: boost keyword results for short queries (< 2 tokens),
   * boost vector results for long semantic queries.
   */
  fuseWeighted(
    rankedLists: RankedResult[][],
    weights: number[],
  ): FusedResult[] {
    if (weights.length !== rankedLists.length) {
      throw new Error('weights.length must equal rankedLists.length');
    }

    const scores = new Map<string, {
      rrfScore: number;
      ranks: number[];
      origScores: number[];
    }>();

    for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
      const list = rankedLists[listIdx];
      const weight = weights[listIdx];

      for (let rank = 0; rank < list.length; rank++) {
        const item = list[rank];
        const contribution = (weight * 1) / (this.k + rank + 1);

        const existing = scores.get(item.id) ?? {
          rrfScore: 0,
          ranks: new Array(rankedLists.length).fill(-1),
          origScores: new Array(rankedLists.length).fill(0),
        };

        existing.rrfScore += contribution;
        existing.ranks[listIdx] = rank + 1;
        existing.origScores[listIdx] = item.score;

        scores.set(item.id, existing);
      }
    }

    const fused: FusedResult[] = [];
    for (const [id, data] of scores) {
      fused.push({
        id,
        rrfScore: data.rrfScore,
        bm25Rank: data.ranks[0] > 0 ? data.ranks[0] : undefined,
        vectorRank: data.ranks[1] > 0 ? data.ranks[1] : undefined,
      });
    }

    return fused.sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Compute optimal weights based on query characteristics.
   * Short queries → more keyword weight
   * Long queries → more vector weight (better semantic understanding)
   */
  computeAdaptiveWeights(queryTokenCount: number): [number, number] {
    if (queryTokenCount <= 2) {
      // Short query: BM25 wins (60% keyword, 40% vector)
      return [0.6, 0.4];
    } else if (queryTokenCount <= 5) {
      // Medium query: balanced
      return [0.5, 0.5];
    } else {
      // Long semantic query: vector wins (35% keyword, 65% vector)
      return [0.35, 0.65];
    }
  }
}
