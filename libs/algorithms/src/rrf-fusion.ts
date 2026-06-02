// ============================================================
// HYPERCOMMERCE — Reciprocal Rank Fusion (RRF)
//
// Merges multiple ranked result lists into a single ranked list.
// Used in Search Service to fuse:
//   - BM25 lexical ranking (Elasticsearch)
//   - kNN vector ranking (dense_vector HNSW)
//   - Personalization re-ranking (user history)
//   - Trending boost (recent order velocity)
//
// Formula: RRF(d) = Σ_r 1 / (k + rank(d, r))
// where k=60 (constant that prevents top results from dominating)
//
// Research: Cormack, Clarke, Buettcher (SIGIR 2009)
// Production use: Elasticsearch 8.x hybrid search, MS Bing
// ============================================================

export interface RankedResult {
  id: string;
  score?: number;   // Original score (BM25, cosine similarity, etc.)
  metadata?: Record<string, unknown>;
}

export interface RRFOptions {
  /**
   * k constant — dampens the effect of very high-ranked results.
   * k=60 is standard (per paper). Higher k = more democratic fusion.
   * k=0 would give first place all the power.
   */
  k?: number;

  /**
   * Weights per ranking list — default all equal.
   * e.g., [0.7, 0.3] weights BM25 70% and kNN 30%.
   * Must match the number of ranked lists passed.
   */
  weights?: number[];
}

export interface FusedResult {
  id: string;
  rrfScore: number;
  originalScores: Record<string, number>;  // 'bm25', 'knn', 'trending' etc.
  rank: number;
}

/**
 * Fuse multiple ranked lists into a single list using RRF.
 *
 * @param rankedLists - Array of ranked result arrays (each already ordered best→worst)
 * @param listNames - Human-readable names for each list (for debugging/logging)
 * @param options - RRF options
 * @returns Merged list, ordered by descending RRF score
 *
 * Example:
 *   const fused = reciprocalRankFusion(
 *     [bm25Results, knnResults, trendingResults],
 *     ['bm25', 'knn', 'trending'],
 *     { k: 60, weights: [0.5, 0.4, 0.1] }
 *   );
 */
export function reciprocalRankFusion(
  rankedLists: RankedResult[][],
  listNames: string[],
  options: RRFOptions = {},
): FusedResult[] {
  const k = options.k ?? 60;
  const weights = normalizeWeights(options.weights, rankedLists.length);

  // Accumulate RRF scores per document ID
  const scoreMap = new Map<string, { rrfScore: number; originalScores: Record<string, number> }>();

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx];
    const weight = weights[listIdx];
    const listName = listNames[listIdx] ?? `list_${listIdx}`;

    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const existing = scoreMap.get(item.id) ?? {
        rrfScore: 0,
        originalScores: {},
      };

      // RRF contribution: weight / (k + rank + 1) — rank is 0-indexed, formula is 1-indexed
      existing.rrfScore += weight / (k + rank + 1);
      existing.originalScores[listName] = item.score ?? (list.length - rank);

      scoreMap.set(item.id, existing);
    }
  }

  // Sort by descending RRF score, break ties by first-seen order (stable)
  const results: FusedResult[] = Array.from(scoreMap.entries()).map(([id, v]) => ({
    id,
    rrfScore: v.rrfScore,
    originalScores: v.originalScores,
    rank: 0, // populated below
  }));

  results.sort((a, b) => b.rrfScore - a.rrfScore);

  // Assign final ranks (1-indexed, human-friendly)
  results.forEach((r, i) => {
    r.rank = i + 1;
  });

  return results;
}

/**
 * Compute normalized discounted cumulative gain (nDCG) for evaluation.
 * Use this in offline A/B tests to compare RRF vs baseline ranking.
 *
 * @param results - Ranked results from fusion
 * @param relevance - Map of doc_id → relevance score (0-3 typical)
 * @param k - Compute nDCG@k
 */
export function ndcgAtK(
  results: FusedResult[],
  relevance: Map<string, number>,
  k: number,
): number {
  const topK = results.slice(0, k);

  const dcg = topK.reduce((sum, result, i) => {
    const rel = relevance.get(result.id) ?? 0;
    return sum + rel / Math.log2(i + 2); // i+2 because log2(1)=0
  }, 0);

  // Ideal DCG: sort relevance scores descending, take top-k
  const idealRels = Array.from(relevance.values())
    .sort((a, b) => b - a)
    .slice(0, k);

  const idcg = idealRels.reduce(
    (sum, rel, i) => sum + rel / Math.log2(i + 2),
    0,
  );

  return idcg === 0 ? 0 : dcg / idcg;
}

function normalizeWeights(weights: number[] | undefined, n: number): number[] {
  if (!weights || weights.length === 0) {
    return Array(n).fill(1 / n);
  }

  if (weights.length !== n) {
    throw new Error(`RRF: weights length (${weights.length}) must match ranked lists count (${n})`);
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

// ── BM25 Scorer ──────────────────────────────────────────────
// In-process BM25 for re-ranking a small candidate set.
// ES already does full BM25 — this is for custom re-ranking
// on the retrieved 1000 candidates before returning top 20.

export interface BM25Options {
  /** Term saturation (default 1.5) — higher k1 = slower saturation */
  k1?: number;
  /** Field length normalization (default 0.75) — 0=no norm, 1=full norm */
  b?: number;
}

export interface BM25Document {
  id: string;
  terms: string[];  // Pre-tokenized
}

export class BM25Scorer {
  private readonly k1: number;
  private readonly b: number;
  private readonly avgDocLength: number;
  private readonly df: Map<string, number> = new Map(); // term → doc freq
  private readonly N: number; // total docs

  constructor(documents: BM25Document[], options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
    this.N = documents.length;

    const totalLength = documents.reduce((s, d) => s + d.terms.length, 0);
    this.avgDocLength = this.N > 0 ? totalLength / this.N : 0;

    // Build document frequency index
    for (const doc of documents) {
      const uniqueTerms = new Set(doc.terms);
      for (const term of uniqueTerms) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
  }

  /**
   * Score a document against a query.
   * BM25(q, d) = Σ_t IDF(t) × (tf × (k1+1)) / (tf + k1×(1-b+b×|d|/avgdl))
   */
  score(query: string[], document: BM25Document): number {
    const tf = buildTermFreq(document.terms);
    const docLen = document.terms.length;

    return query.reduce((sum, term) => {
      const termTf = tf.get(term) ?? 0;
      if (termTf === 0) return sum;

      const idf = this.idf(term);
      const numerator = termTf * (this.k1 + 1);
      const denominator =
        termTf + this.k1 * (1 - this.b + (this.b * docLen) / this.avgDocLength);

      return sum + idf * (numerator / denominator);
    }, 0);
  }

  /** Batch score — returns sorted results, best first */
  rank(query: string[], documents: BM25Document[]): Array<{ id: string; score: number }> {
    const scored = documents.map((doc) => ({
      id: doc.id,
      score: this.score(query, doc),
    }));

    return scored.sort((a, b) => b.score - a.score);
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    // Smooth IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    return Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
  }
}

function buildTermFreq(terms: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const term of terms) {
    freq.set(term, (freq.get(term) ?? 0) + 1);
  }
  return freq;
}
