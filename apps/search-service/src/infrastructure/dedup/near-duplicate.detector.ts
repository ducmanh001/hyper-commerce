/**
 * NearDuplicateDetector — MinHash + LSH applied to product deduplication
 *
 * PROBLEM:
 *   On a marketplace, different sellers list the same product with slightly
 *   different titles/descriptions:
 *   - "iPhone 15 Pro Max 256GB Black Titanium"
 *   - "Apple iPhone 15 Pro Max 256GB Đen Titanium"
 *   - "IPHONE 15 PRO MAX 256 TITAN ĐEN"
 *
 *   These are near-duplicates (same product, different listings).
 *   Showing all 3 in search results wastes space and confuses users.
 *
 * ALGORITHM: MinHash + LSH (Locality-Sensitive Hashing)
 *
 * STEP 1: Shingling
 *   Convert text to a set of k-shingles (character n-grams).
 *   "iphone 15 pro" → {_ip, iph, pho, hon, one, ne_, e_1, _15, 15_, 5_p, ...}
 *   Why shingles? Two strings with 80% shingle overlap are probably the same product.
 *
 * STEP 2: MinHash signature
 *   Hash each shingle with N different hash functions.
 *   For each hash function, keep the minimum hash value.
 *   Result: N-dimensional signature vector (the "MinHash signature").
 *   Key property: Prob(sig_A[i] == sig_B[i]) ≈ Jaccard(A, B)
 *   So if two signatures match in 80% of positions → Jaccard ≈ 0.8 → near-duplicate.
 *
 * STEP 3: LSH Banding
 *   Comparing N-dim signatures for all pairs is O(N²) — too slow at scale.
 *   LSH groups similar items into "buckets" (hash bands).
 *   If any band matches, items are "candidate pairs" → full similarity check.
 *   This brings complexity from O(N²) to O(N) for typical data.
 *
 * REAL-WORLD USAGE HERE:
 *   Called by ProductIndexer when indexing a new product.
 *   If near-duplicate found → flag for human review or auto-group.
 *   Not called per-query (too slow) — runs at index time.
 *
 * PERFORMANCE:
 *   128 permutations × 16 bands × 8 rows = typical for 80% threshold
 *   Index time: ~2ms per product
 *   Memory: LSH index fits in RAM for up to ~10M products
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { MinHash, LSHIndex } from '@hypercommerce/algorithms';
import algorithmConfig, { AlgorithmConfigProps } from '@hypercommerce/common/config/algorithm.config';

export interface DuplicateCandidate {
  existingProductId: string;
  estimatedSimilarity: number;
}

@Injectable()
export class NearDuplicateDetector {
  private readonly logger = new Logger(NearDuplicateDetector.name);
  private readonly minHash: MinHash;
  private readonly lshIndex: LSHIndex;
  /** Local signature store — LSHIndex stores them internally but we need
   * direct access for similarity re-ranking after candidate retrieval */
  private readonly signatures = new Map<string, number[]>();
  private readonly SHINGLE_SIZE = 3; // character trigrams

  constructor(
    @Inject(algorithmConfig.KEY) private readonly config: AlgorithmConfigProps,
  ) {
    const { numPermutations, bands, rowsPerBand } = config.minHash;

    this.minHash = new MinHash({ numHashes: numPermutations });
    this.lshIndex = new LSHIndex({ bands, rowsPerBand });
  }

  /**
   * Check if a newly indexed product is a near-duplicate of an existing one.
   * Called during product indexing (not search).
   *
   * @returns Array of candidate duplicates, sorted by similarity descending
   */
  findDuplicates(
    productId: string,
    productText: string,
  ): DuplicateCandidate[] {
    const shingles  = [...this.shingle(productText)];
    const signature = this.minHash.signature(shingles);

    const candidateIds = [...this.lshIndex.query(signature)];

    if (candidateIds.length === 0) return [];

    const threshold = this.config.minHash.similarityThreshold;

    const results: DuplicateCandidate[] = candidateIds
      .filter((id) => id !== productId)
      .map((existingId) => {
        const existingSig = this.signatures.get(existingId);
        if (!existingSig) return null;
        const similarity = this.minHash.estimateSimilarity(signature, existingSig);
        return { existingProductId: existingId, estimatedSimilarity: similarity };
      })
      .filter((r): r is DuplicateCandidate => r !== null && r.estimatedSimilarity >= threshold)
      .sort((a, b) => b.estimatedSimilarity - a.estimatedSimilarity);

    if (results.length > 0) {
      this.logger.warn({
        event: 'near_duplicate_detected',
        newProduct: productId,
        duplicates: results.slice(0, 3),
      });
    }

    return results;
  }

  /**
   * Add a product to the LSH index.
   * Called when indexing a product — enables future duplicate detection.
   */
  indexProduct(productId: string, productText: string): void {
    const shingles  = [...this.shingle(productText)];
    const signature = this.minHash.signature(shingles);
    this.lshIndex.insert(productId, signature);
    this.signatures.set(productId, signature);
  }

  /**
   * Remove a deleted product from the index.
   */
  removeProduct(productId: string): void {
    this.signatures.delete(productId);
  }

  /**
   * Current index size (for monitoring/health-checks)
   */
  get indexSize(): number {
    return this.signatures.size;
  }

  // ── Text preprocessing ─────────────────────────────────────────────────────

  /**
   * Convert a product title/description to a Set of character k-shingles.
   *
   * WHY CHARACTER (not word) shingles:
   *   "iPhone15Pro" and "iPhone 15 Pro" differ in spaces — word shingles miss this.
   *   Character trigrams capture these variations.
   *
   * NORMALIZATION:
   *   Lowercase + remove special chars → handles "IPHONE 15!!!" ≡ "iphone 15"
   */
  private shingle(text: string): Set<string> {
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\s]/g, '') // keep Latin + Vietnamese
      .replace(/\s+/g, ' ')
      .trim();

    const shingles = new Set<string>();
    for (let i = 0; i <= normalized.length - this.SHINGLE_SIZE; i++) {
      shingles.add(normalized.slice(i, i + this.SHINGLE_SIZE));
    }
    return shingles;
  }
}
