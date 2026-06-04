// ============================================================
// HYPERCOMMERCE — Bloom Filter
// Probabilistic data structure: O(1) insert + O(1) lookup
//
// Use cases in HYPERCOMMERCE:
//   1. Order idempotency: "has this idempotency key been seen?"
//   2. Feed deduplication: "has user already seen this post?"
//   3. URL/product dedup in search indexer
//   4. Spam filter: "is this email known-spam?"
//
// Trade-off: false positives possible, zero false negatives.
// FP rate = (1 - e^(-kn/m))^k where k=hashes, n=items, m=bits
//
// For 1M items, FP=0.1%: m=14.4M bits (1.8MB), k=10 hashes
// For 10M items, FP=0.1%: m=144M bits (18MB), k=10 hashes
// ============================================================

/**
 * MurmurHash3 — fast non-cryptographic hash.
 * Used instead of crypto.createHash (too slow for hot paths).
 * Based on Austin Appleby's public domain implementation.
 */
function murmurhash3_32(key: string, seed: number): number {
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < key.length - 3; i += 4) {
    let k1 =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  // Tail
  const remaining = key.length & 3;
  let k1 = 0;
  if (remaining === 3) k1 ^= (key.charCodeAt(key.length - 3) & 0xff) << 16;
  if (remaining >= 2) k1 ^= (key.charCodeAt(key.length - 2) & 0xff) << 8;
  if (remaining >= 1) {
    k1 ^= key.charCodeAt(key.length - 1) & 0xff;
    k1 = Math.imul(k1, c1);
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  // Finalization
  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

export interface BloomFilterOptions {
  /** Expected number of items (n) */
  expectedItems: number;
  /** Desired false positive rate (0.001 = 0.1%) */
  falsePositiveRate: number;
}

export class BloomFilter {
  private readonly bitArray: Uint8Array;
  private readonly bitSize: number;
  private readonly hashCount: number;
  private itemCount = 0;

  constructor(options: BloomFilterOptions) {
    // Optimal bit size: m = -n * ln(p) / (ln2)^2
    this.bitSize = Math.ceil(
      (-options.expectedItems * Math.log(options.falsePositiveRate)) / (Math.LN2 * Math.LN2),
    );

    // Optimal hash count: k = (m/n) * ln2
    this.hashCount = Math.ceil((this.bitSize / options.expectedItems) * Math.LN2);

    // Uint8Array: 1 byte per 8 bits, fills to zero by default
    this.bitArray = new Uint8Array(Math.ceil(this.bitSize / 8));
  }

  /** Insert an element — O(k) where k = hash count (typically 7-15) */
  add(item: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const pos = murmurhash3_32(item, i) % this.bitSize;
      // Set bit at position pos
      this.bitArray[Math.floor(pos / 8)] |= 1 << (pos % 8);
    }
    this.itemCount++;
  }

  /**
   * Test membership — O(k)
   * Returns: false = DEFINITELY not in set
   *          true  = PROBABLY in set (may false positive)
   */
  has(item: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const pos = murmurhash3_32(item, i) % this.bitSize;
      if (!(this.bitArray[Math.floor(pos / 8)] & (1 << (pos % 8)))) {
        return false; // Definite miss
      }
    }
    return true; // Probable hit
  }

  /** Current false positive rate based on actual item count */
  estimatedFalsePositiveRate(): number {
    return Math.pow(
      1 - Math.exp((-this.hashCount * this.itemCount) / this.bitSize),
      this.hashCount,
    );
  }

  get size(): number {
    return this.itemCount;
  }

  get memorySizeBytes(): number {
    return this.bitArray.byteLength;
  }

  /** Serialize to Buffer for Redis storage */
  toBuffer(): Buffer {
    return Buffer.from(this.bitArray.buffer);
  }

  /** Restore from Buffer (loaded from Redis) */
  static fromBuffer(buf: Buffer, options: BloomFilterOptions): BloomFilter {
    const filter = new BloomFilter(options);
    const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    filter.bitArray.set(src.slice(0, filter.bitArray.length));
    return filter;
  }

  /**
   * Union two filters (bitwise OR).
   * Useful for merging shard-local filters into a global one.
   */
  union(other: BloomFilter): BloomFilter {
    if (this.bitSize !== other.bitSize) {
      throw new Error('Cannot union filters with different sizes');
    }
    const result = new BloomFilter({ expectedItems: 1, falsePositiveRate: 0.01 });
    // Access private via cast for union factory
    const resultInternal = result as unknown as { bitArray: Uint8Array };
    resultInternal.bitArray = new Uint8Array(this.bitArray.length);
    for (let i = 0; i < this.bitArray.length; i++) {
      resultInternal.bitArray[i] = this.bitArray[i] | other.bitArray[i];
    }
    return result;
  }
}

// ── Scalable Bloom Filter ─────────────────────────────────────
// Automatically grows when fill rate exceeds threshold.
// Use this when expected item count is not known upfront.
export class ScalableBloomFilter {
  private readonly filters: BloomFilter[] = [];
  private readonly targetFpr: number;
  private readonly growthFactor: number;

  constructor(
    private readonly initialCapacity: number,
    private readonly falsePositiveRate = 0.01,
    growthFactor = 2,
  ) {
    this.targetFpr = falsePositiveRate;
    this.growthFactor = growthFactor;
    this.addFilter(initialCapacity);
  }

  add(item: string): void {
    const current = this.filters[this.filters.length - 1];
    if (current.estimatedFalsePositiveRate() > this.targetFpr * 0.9) {
      // Current filter getting full — grow
      this.addFilter(this.initialCapacity * Math.pow(this.growthFactor, this.filters.length));
    }
    this.filters[this.filters.length - 1].add(item);
  }

  has(item: string): boolean {
    // Check all filters — any hit = probable member
    return this.filters.some((f) => f.has(item));
  }

  private addFilter(capacity: number): void {
    this.filters.push(
      new BloomFilter({
        expectedItems: Math.ceil(capacity),
        falsePositiveRate: this.targetFpr / Math.pow(2, this.filters.length),
      }),
    );
  }

  get filterCount(): number {
    return this.filters.length;
  }
}
