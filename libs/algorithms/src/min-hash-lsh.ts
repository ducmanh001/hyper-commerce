// ============================================================
// HYPERCOMMERCE — Min-Hash + LSH (Locality Sensitive Hashing)
//
// Use cases:
//   1. Near-duplicate product detection (same product, diff seller)
//   2. Similar user detection for collaborative filtering cold-start
//   3. Dedup livestream thumbnails
//   4. Plagiarism detection in product descriptions
//
// Min-Hash estimates Jaccard similarity between sets WITHOUT
// computing the full set intersection.
//
// Jaccard(A, B) = |A ∩ B| / |A ∪ B|
// MinHash estimate: P(min_h(A) == min_h(B)) = Jaccard(A, B)
//
// LSH bands: b bands × r rows. Two items are a candidate pair
// if they hash to the same bucket in at least ONE band.
// Threshold ≈ (1/b)^(1/r)
// ============================================================

/**
 * Universal hash family: h(x) = ((a*x + b) % p) % m
 * where p is a prime larger than universe, a,b random
 */
function universalHash(x: number, a: number, b: number, p: number, m: number): number {
  return ((a * x + b) % p) % m;
}

export interface MinHashOptions {
  /** Number of hash functions (signature size). Higher = more accurate. */
  numHashes: number;
}

export class MinHash {
  private readonly numHashes: number;
  private readonly hashParams: Array<{ a: number; b: number }>;
  private static readonly LARGE_PRIME = 2_147_483_647; // Mersenne prime 2^31-1

  constructor(options: MinHashOptions) {
    this.numHashes = options.numHashes;

    // Generate random (a, b) pairs for universal hashing
    this.hashParams = Array.from({ length: this.numHashes }, () => ({
      a: Math.floor(Math.random() * (MinHash.LARGE_PRIME - 1)) + 1,
      b: Math.floor(Math.random() * (MinHash.LARGE_PRIME - 1)),
    }));
  }

  /**
   * Compute MinHash signature for a set.
   * O(n × k) where n = set size, k = num hashes
   *
   * @param items - Set represented as array of strings
   * @returns Signature array of length numHashes
   */
  signature(items: string[]): number[] {
    if (items.length === 0) return Array(this.numHashes).fill(0);

    const sig = Array(this.numHashes).fill(Infinity);

    for (const item of items) {
      const itemHash = this.stringToInt(item);

      for (let i = 0; i < this.numHashes; i++) {
        const { a, b } = this.hashParams[i];
        const h = universalHash(itemHash, a, b, MinHash.LARGE_PRIME, MinHash.LARGE_PRIME);
        if (h < sig[i]) sig[i] = h;
      }
    }

    return sig;
  }

  /**
   * Estimate Jaccard similarity between two pre-computed signatures.
   * O(k) — much faster than actual Jaccard which is O(|A| + |B|)
   */
  estimateSimilarity(sig1: number[], sig2: number[]): number {
    let matches = 0;
    for (let i = 0; i < this.numHashes; i++) {
      if (sig1[i] === sig2[i]) matches++;
    }
    return matches / this.numHashes;
  }

  private stringToInt(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
}

// ── LSH Index (Banding technique) ────────────────────────────
export interface LSHOptions {
  /** Number of bands */
  bands: number;
  /** Rows per band */
  rowsPerBand: number;
}

export interface SimilarPair {
  id1: string;
  id2: string;
  estimatedSimilarity: number;
}

export class LSHIndex {
  private readonly buckets: Map<string, string[]>[] = [];
  private readonly numBands: number;
  private readonly rowsPerBand: number;
  private readonly signatures = new Map<string, number[]>();

  constructor(private readonly options: LSHOptions) {
    this.numBands = options.bands;
    this.rowsPerBand = options.rowsPerBand;

    // Initialize bucket maps, one per band
    for (let i = 0; i < this.numBands; i++) {
      this.buckets.push(new Map());
    }
  }

  /**
   * Insert an item signature into the LSH index.
   *
   * @param id - Item identifier
   * @param signature - MinHash signature
   */
  insert(id: string, signature: number[]): void {
    this.signatures.set(id, signature);

    for (let band = 0; band < this.numBands; band++) {
      const start = band * this.rowsPerBand;
      const end = start + this.rowsPerBand;
      const bandKey = `${band}:${signature.slice(start, end).join(',')}`;

      const bucket = this.buckets[band].get(bandKey) ?? [];
      bucket.push(id);
      this.buckets[band].set(bandKey, bucket);
    }
  }

  /**
   * Query candidate similar items for a given signature.
   * Returns items that share at least one band bucket.
   */
  query(signature: number[]): Set<string> {
    const candidates = new Set<string>();

    for (let band = 0; band < this.numBands; band++) {
      const start = band * this.rowsPerBand;
      const end = start + this.rowsPerBand;
      const bandKey = `${band}:${signature.slice(start, end).join(',')}`;

      const bucket = this.buckets[band].get(bandKey) ?? [];
      for (const id of bucket) {
        candidates.add(id);
      }
    }

    return candidates;
  }

  /**
   * Find all near-duplicate pairs in the index.
   * O(n × b) — faster than brute-force O(n²)
   */
  findSimilarPairs(minSimilarity: number, minHash: MinHash): SimilarPair[] {
    const pairs: SimilarPair[] = [];
    const checked = new Set<string>();

    for (const [id, sig] of this.signatures) {
      const candidates = this.query(sig);
      candidates.delete(id); // Remove self

      for (const candidate of candidates) {
        const pairKey = [id, candidate].sort().join('|');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const candidateSig = this.signatures.get(candidate)!;
        const similarity = minHash.estimateSimilarity(sig, candidateSig);

        if (similarity >= minSimilarity) {
          pairs.push({ id1: id, id2: candidate, estimatedSimilarity: similarity });
        }
      }
    }

    return pairs.sort((a, b) => b.estimatedSimilarity - a.estimatedSimilarity);
  }

  /**
   * Threshold for candidate pair selection:
   * P(candidate | similarity=s) ≈ 1 - (1 - s^r)^b
   * This computes the similarity threshold at ~50% detection rate.
   */
  static thresholdAt50Percent(bands: number, rowsPerBand: number): number {
    return Math.pow(1 / bands, 1 / rowsPerBand);
  }
}
