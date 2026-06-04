/**
 * AlgorithmConfig — All algorithm tuning parameters, driven by environment variables.
 *
 * WHY: Hardcoding algorithm parameters is an anti-pattern because:
 *   - Production needs different values than dev (BF capacity, HLL precision)
 *   - Tuning requires restart without code changes
 *   - Different services may need different algorithm budgets
 *
 * USAGE:
 *   // In your module:
 *   ConfigModule.forRoot({ load: [algorithmConfig] })
 *
 *   // In your service:
 *   constructor(@Inject(algorithmConfig.KEY) private config: AlgorithmConfigProps) {}
 *
 * TUNING GUIDE:
 *   BloomFilter:
 *     - expectedCapacity: estimate max items (seen products per user)
 *     - falsePositiveRate: 0.01 means ~1% of "not seen" items are incorrectly
 *       reported as "seen". Acceptable for feed dedup, bad for billing.
 *
 *   HyperLogLog:
 *     - precision 14 → 16384 registers → ~0.81% error → ~160KB RAM
 *     - precision 12 → 4096 registers  → ~1.6% error  → ~40KB RAM
 *     - precision 16 → 65536 registers → ~0.4% error  → ~640KB RAM
 *
 *   MinHash/LSH:
 *     - numPermutations: 128 gives good accuracy. More = more CPU.
 *     - bands × rowsPerBand = numPermutations (128 = 16 bands × 8 rows)
 *     - Similarity threshold ~0.8 means 80% Jaccard overlap = near-duplicate
 *
 *   RRF:
 *     - k=60 is standard (from the original paper). Higher k → less sensitive to top ranks.
 *     - vectorWeight/keywordWeight: tune for your query distribution
 */
import { registerAs } from '@nestjs/config';

export interface AlgorithmConfigProps {
  bloomFilter: {
    expectedCapacity: number;
    falsePositiveRate: number;
    scalingFactor: number; // How much capacity grows per ScalableBloomFilter tier
  };
  trie: {
    maxSuggestions: number;
    maxQueryLength: number;
    snapshotIntervalMs: number; // How often to persist Trie to Redis
    maxTerms: number; // Evict LRU terms after this many insertions
  };
  minHash: {
    numPermutations: number;
    bands: number;
    rowsPerBand: number;
    similarityThreshold: number;
  };
  hyperLogLog: {
    precision: number; // b bits, 4–16
  };
  countMinSketch: {
    width: number; // Buckets per hash function row
    depth: number; // Number of hash function rows
    topKWindow: number; // Track top-K (e.g., top 100 trending)
  };
  consistentHashing: {
    virtualNodes: number; // Vnodes per physical node (150–200 recommended)
  };
  rrf: {
    k: number;
    vectorWeight: number;
    keywordWeight: number;
  };
  twoTower: {
    embeddingDim: number;
    maxItemsToRank: number;
    mmrLambda: number; // 0.0=diversity, 1.0=pure relevance
  };
  rateLimiter: {
    defaultRpm: number;
    defaultBurstSize: number;
    cleanupIntervalMs: number; // How often to evict expired buckets from LRU
  };
}

export default registerAs(
  'algorithm',
  (): AlgorithmConfigProps => ({
    bloomFilter: {
      expectedCapacity: parseInt(process.env.BF_CAPACITY ?? '1000000', 10),
      falsePositiveRate: parseFloat(process.env.BF_FPR ?? '0.01'),
      scalingFactor: parseInt(process.env.BF_SCALE ?? '4', 10),
    },
    trie: {
      maxSuggestions: parseInt(process.env.TRIE_MAX_SUGGESTIONS ?? '10', 10),
      maxQueryLength: parseInt(process.env.TRIE_MAX_QUERY_LEN ?? '100', 10),
      snapshotIntervalMs: parseInt(process.env.TRIE_SNAPSHOT_MS ?? '300000', 10),
      maxTerms: parseInt(process.env.TRIE_MAX_TERMS ?? '500000', 10),
    },
    minHash: {
      numPermutations: parseInt(process.env.MINHASH_PERMS ?? '128', 10),
      bands: parseInt(process.env.LSH_BANDS ?? '16', 10),
      rowsPerBand: parseInt(process.env.LSH_ROWS ?? '8', 10),
      similarityThreshold: parseFloat(process.env.LSH_THRESHOLD ?? '0.80'),
    },
    hyperLogLog: {
      precision: parseInt(process.env.HLL_PRECISION ?? '14', 10),
    },
    countMinSketch: {
      width: parseInt(process.env.CMS_WIDTH ?? '2000', 10),
      depth: parseInt(process.env.CMS_DEPTH ?? '5', 10),
      topKWindow: parseInt(process.env.CMS_TOP_K ?? '100', 10),
    },
    consistentHashing: {
      virtualNodes: parseInt(process.env.CH_VNODES ?? '150', 10),
    },
    rrf: {
      k: parseInt(process.env.RRF_K ?? '60', 10),
      vectorWeight: parseFloat(process.env.RRF_VECTOR_WEIGHT ?? '0.6'),
      keywordWeight: parseFloat(process.env.RRF_KEYWORD_WEIGHT ?? '0.4'),
    },
    twoTower: {
      embeddingDim: parseInt(process.env.TT_EMBEDDING_DIM ?? '256', 10),
      maxItemsToRank: parseInt(process.env.TT_MAX_ITEMS ?? '200', 10),
      mmrLambda: parseFloat(process.env.TT_MMR_LAMBDA ?? '0.7'),
    },
    rateLimiter: {
      defaultRpm: parseInt(process.env.RATE_LIMIT_RPM ?? '60', 10),
      defaultBurstSize: parseInt(process.env.RATE_LIMIT_BURST ?? '20', 10),
      cleanupIntervalMs: parseInt(process.env.RATE_LIMIT_CLEANUP_MS ?? '60000', 10),
    },
  }),
);
