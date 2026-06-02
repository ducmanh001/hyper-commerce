// ============================================================
// HYPERCOMMERCE — Two-Tower Model (Recommendation Engine)
//
// Architecture used by YouTube, TikTok, Pinterest, Airbnb.
// Two separate towers:
//   - User Tower: encodes user context (history, demographics)
//   - Item Tower: encodes item features (category, price, title)
//
// At serving time:
//   1. Compute user embedding (changes per request)
//   2. Item embeddings pre-computed + stored in Redis/ES HNSW index
//   3. ANN search (kNN) finds top-K candidate items
//   4. Re-rank candidates with more expensive features
//
// Production:
//   - Training: PyTorch + FAISS, offline nightly
//   - Serving: OpenAI embeddings API (text-embedding-3-large, 3072 dims)
//     or custom model hosted on Hugging Face Inference Endpoints
//   - This file contains the TypeScript serving-side logic
//     (embedding lookup + cosine similarity + ANN query building)
// ============================================================

export interface UserContext {
  userId: string;
  /** Recent product IDs viewed/purchased (last 50) */
  recentItems: string[];
  /** Category preferences from history */
  categoryPreferences: Record<string, number>;
  /** Geographic region */
  region?: string;
  /** Hour of day 0-23 (temporal signal) */
  hourOfDay?: number;
  /** Day of week 0-6 */
  dayOfWeek?: number;
}

export interface ItemFeatures {
  itemId: string;
  title: string;
  category: string;
  price: number;
  /** Pre-computed embedding vector from Item Tower */
  embedding?: number[];
}

export interface RecommendationScore {
  itemId: string;
  score: number;
  reason: 'collaborative' | 'content' | 'trending' | 'new' | 'hybrid';
}

// ── Cosine Similarity ─────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Used to measure user-item embedding alignment.
 * Returns [-1, 1] where 1 = identical direction.
 *
 * Optimized: single loop, avoid sqrt via normalized vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * L2-normalize a vector (required for fast dot-product similarity
 * when vectors are stored pre-normalized in HNSW index).
 */
export function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

/**
 * Build a user tower embedding from behavioral features.
 * In production, this calls the user encoder neural network.
 * Here, it's a feature engineering approach using item embeddings.
 *
 * User embedding = weighted average of recent item embeddings
 * where weight decays exponentially with recency.
 *
 * @param recentItemEmbeddings - [(embedding, timestamp_ms)]
 * @param halfLifeMs - Time for weight to halve (default 7 days)
 */
export function buildUserEmbedding(
  recentItemEmbeddings: Array<{ embedding: number[]; timestampMs: number }>,
  halfLifeMs = 7 * 24 * 60 * 60 * 1000,
): number[] | null {
  if (recentItemEmbeddings.length === 0) return null;

  const dims = recentItemEmbeddings[0].embedding.length;
  const result = new Array<number>(dims).fill(0);
  const now = Date.now();
  let totalWeight = 0;

  for (const { embedding, timestampMs } of recentItemEmbeddings) {
    // Exponential time decay: weight = 2^(-age/halfLife)
    const ageMs = now - timestampMs;
    const weight = Math.pow(2, -ageMs / halfLifeMs);
    totalWeight += weight;

    for (let i = 0; i < dims; i++) {
      result[i] += embedding[i] * weight;
    }
  }

  if (totalWeight === 0) return null;

  // Normalize by total weight
  for (let i = 0; i < dims; i++) {
    result[i] /= totalWeight;
  }

  return l2Normalize(result);
}

// ── Collaborative Filtering (Memory-Based) ───────────────────
// User-user CF: find similar users, recommend what they liked.
// Item-item CF: find similar items, recommend based on current view.
// Both are O(n) after pre-computation.

export interface UserItemInteraction {
  userId: string;
  itemId: string;
  rating: number;   // Implicit: 1=view, 2=like, 3=cart, 5=purchase
  timestamp: number;
}

/**
 * Build item similarity matrix using adjusted cosine similarity.
 * Run this offline (nightly) and store results in Redis sorted sets.
 *
 * Adjusted cosine: accounts for user rating bias
 * sim(i, j) = Σ_u (r_ui - r_u) × (r_uj - r_u) / normalization
 */
export function buildItemSimilarityMatrix(
  interactions: UserItemInteraction[],
  maxCandidates = 50,
): Map<string, Array<{ itemId: string; similarity: number }>> {
  // Build user→item rating map
  const userMeans = new Map<string, number>();
  const userInteractions = new Map<string, Map<string, number>>();

  for (const interaction of interactions) {
    const userItems = userInteractions.get(interaction.userId) ?? new Map();
    userItems.set(interaction.itemId, interaction.rating);
    userInteractions.set(interaction.userId, userItems);
  }

  // Compute per-user mean rating (for adjustment)
  for (const [userId, items] of userInteractions) {
    const ratings = Array.from(items.values());
    const mean = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    userMeans.set(userId, mean);
  }

  // Build item→item similarity
  const allItems = new Set(interactions.map((i) => i.itemId));
  const result = new Map<string, Array<{ itemId: string; similarity: number }>>();

  for (const item1 of allItems) {
    const similarities: Array<{ itemId: string; similarity: number }> = [];

    for (const item2 of allItems) {
      if (item1 === item2) continue;

      // Find users who rated both items
      let dot = 0;
      let normA = 0;
      let normB = 0;

      for (const [userId, items] of userInteractions) {
        const r1 = items.get(item1);
        const r2 = items.get(item2);
        if (r1 === undefined || r2 === undefined) continue;

        const mean = userMeans.get(userId) ?? 0;
        const adj1 = r1 - mean;
        const adj2 = r2 - mean;

        dot += adj1 * adj2;
        normA += adj1 * adj1;
        normB += adj2 * adj2;
      }

      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      if (denom === 0) continue;

      const sim = dot / denom;
      if (sim > 0) {
        similarities.push({ itemId: item2, similarity: sim });
      }
    }

    // Keep only top-K similar items (memory efficiency)
    similarities.sort((a, b) => b.similarity - a.similarity);
    result.set(item1, similarities.slice(0, maxCandidates));
  }

  return result;
}

// ── Diversity Injection (MMR) ─────────────────────────────────
// Maximal Marginal Relevance: balance relevance vs diversity.
// Prevents recommendation echo chamber (all same category).
// MMR = argmax [ λ × rel(d) - (1-λ) × max_sim(d, selected) ]

export function maximalMarginalRelevance(
  candidates: Array<{ id: string; score: number; embedding: number[] }>,
  lambda = 0.7,  // 0=full diversity, 1=full relevance
  k = 20,
): Array<{ id: string; score: number }> {
  if (candidates.length === 0) return [];

  const selected: typeof candidates = [];
  const remaining = [...candidates];

  // Always select the top-1 result first
  selected.push(remaining.splice(0, 1)[0]);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];

      // Relevance score (normalized to [0,1])
      const rel = candidate.score;

      // Max similarity to already selected items
      const maxSim = Math.max(
        ...selected.map((s) => cosineSimilarity(candidate.embedding, s.embedding)),
      );

      const mmrScore = lambda * rel - (1 - lambda) * maxSim;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected.map(({ id, score }) => ({ id, score }));
}
