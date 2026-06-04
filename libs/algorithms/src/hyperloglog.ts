// ============================================================
// HYPERCOMMERCE — HyperLogLog (cardinality estimation)
//
// Use cases:
//   1. "How many unique viewers watched this livestream?"
//   2. "How many unique users clicked this product today?"
//   3. Unique visitor counts per page
//   4. A/B test audience size estimation
//
// HyperLogLog: O(1) space, ~2% error, handles 10^18 elements
// Memory: ~1.5KB for 64-register HLL (vs ~80MB for exact Set)
//
// Redis has native HLL: PFADD / PFCOUNT — use that in production.
// This in-process implementation is for batch offline processing
// and for cases where Redis is unavailable.
//
// Algorithm by Flajolet, Fusy, Gandouet, Meunier (2007)
// ============================================================

/**
 * MurmurHash3 64-bit simulation using 32-bit parts.
 * Returns [high32, low32].
 */
function hash64(item: string): [number, number] {
  const h1 = murmurhash3(item, 0x9747b28c) >>> 0;
  const h2 = murmurhash3(item, 0x5b08b34c) >>> 0;
  return [h1, h2];
}

function murmurhash3(key: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++) {
    let k = key.charCodeAt(i);
    k = Math.imul(k, 0xcc9e2d51);
    k = ((k << 15) | (k >>> 17)) >>> 0;
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= key.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class HyperLogLog {
  private readonly m: number; // Number of registers (2^precision)
  private readonly registers: Uint8Array;
  private readonly precision: number;

  /**
   * @param precision - Between 4 and 16.
   *   p=4: 16 registers, ~26% error, 16 bytes
   *   p=10: 1024 registers, ~3.2% error, 1KB
   *   p=14: 16384 registers, ~0.8% error, 16KB (standard Redis HLL)
   */
  constructor(precision = 14) {
    if (precision < 4 || precision > 16) {
      throw new Error('HyperLogLog precision must be between 4 and 16');
    }
    this.precision = precision;
    this.m = 1 << precision;
    this.registers = new Uint8Array(this.m);
  }

  /** Add an element to the HLL */
  add(item: string): void {
    const [h1, h2] = hash64(item);

    // Use first 'precision' bits as register index
    const registerIdx = h1 >>> (32 - this.precision);

    // Position of leftmost 1-bit in remaining bits
    const remaining = ((h1 << this.precision) | (h2 >>> (32 - this.precision))) >>> 0;
    const zeros = countLeadingZeros(remaining) + 1;

    // Keep max (position of leftmost 1-bit)
    if (zeros > this.registers[registerIdx]) {
      this.registers[registerIdx] = zeros;
    }
  }

  /**
   * Estimate cardinality (unique count).
   * Standard bias correction for small/large range estimates.
   */
  count(): number {
    // Harmonic mean of 2^register values
    let sum = 0;
    let zeros = 0;

    for (let i = 0; i < this.m; i++) {
      sum += Math.pow(2, -this.registers[i]);
      if (this.registers[i] === 0) zeros++;
    }

    const alpha = this.getAlpha();
    let estimate = (alpha * this.m * this.m) / sum;

    // Small range correction (linear counting)
    if (estimate <= 2.5 * this.m && zeros > 0) {
      estimate = this.m * Math.log(this.m / zeros);
    }

    // Large range correction
    const maxCardinality = Math.pow(2, 32);
    if (estimate > maxCardinality / 30) {
      estimate = -maxCardinality * Math.log(1 - estimate / maxCardinality);
    }

    return Math.round(estimate);
  }

  /** Merge two HLLs — useful for distributed counting */
  merge(other: HyperLogLog): void {
    if (this.precision !== other.precision) {
      throw new Error('Cannot merge HLLs with different precision');
    }
    for (let i = 0; i < this.m; i++) {
      if (other.registers[i] > this.registers[i]) {
        this.registers[i] = other.registers[i];
      }
    }
  }

  /** Serialize to Buffer for Redis storage */
  toBuffer(): Buffer {
    return Buffer.from(this.registers.buffer);
  }

  static fromBuffer(buf: Buffer, precision = 14): HyperLogLog {
    const hll = new HyperLogLog(precision);
    const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    hll.registers.set(src.slice(0, hll.registers.length));
    return hll;
  }

  private getAlpha(): number {
    switch (this.m) {
      case 16:
        return 0.673;
      case 32:
        return 0.697;
      case 64:
        return 0.709;
      default:
        return 0.7213 / (1 + 1.079 / this.m);
    }
  }
}

function countLeadingZeros(n: number): number {
  if (n === 0) return 32;
  let count = 0;
  if ((n & 0xffff0000) === 0) {
    count += 16;
    n <<= 16;
  }
  if ((n & 0xff000000) === 0) {
    count += 8;
    n <<= 8;
  }
  if ((n & 0xf0000000) === 0) {
    count += 4;
    n <<= 4;
  }
  if ((n & 0xc0000000) === 0) {
    count += 2;
    n <<= 2;
  }
  if ((n & 0x80000000) === 0) {
    count += 1;
  }
  return count;
}

// ── Count-Min Sketch — frequency estimation ───────────────────
// "How many times has user X purchased product Y today?"
// O(1) update, O(1) query, fixed memory regardless of items.
export class CountMinSketch {
  private readonly table: Uint32Array[];
  private readonly width: number;
  private readonly depth: number;

  /**
   * @param width - Number of counters per row (larger = less error)
   * @param depth - Number of rows / hash functions (larger = less failure prob)
   * Standard: width=2000, depth=7 → error < 0.1% with 99% confidence
   */
  constructor(width = 2000, depth = 7) {
    this.width = width;
    this.depth = depth;
    this.table = Array.from({ length: depth }, () => new Uint32Array(width));
  }

  increment(item: string, count = 1): void {
    for (let i = 0; i < this.depth; i++) {
      const pos = murmurhash3(item, i * 1000) % this.width;
      this.table[i][pos] += count;
    }
  }

  query(item: string): number {
    let min = Infinity;
    for (let i = 0; i < this.depth; i++) {
      const pos = murmurhash3(item, i * 1000) % this.width;
      if (this.table[i][pos] < min) min = this.table[i][pos];
    }
    return min;
  }

  get memorySizeBytes(): number {
    return this.width * this.depth * 4; // Uint32 = 4 bytes
  }
}
