// apps/ai-service/src/constants/ai.constants.ts

export const AI_ERRORS = {
  USER_NOT_FOUND: 'AI_001',
  EMBEDDING_FAILED: 'AI_002',
  MODEL_UNAVAILABLE: 'AI_003',
  INFERENCE_TIMEOUT: 'AI_004',
  FRAUD_SCORE_FAILED: 'AI_005',
} as const;

export const AI_LIMITS = {
  MAX_RECOMMENDATIONS: 100,
  DEFAULT_RECOMMENDATIONS: 20,
  MAX_EMBEDDING_BATCH: 128, // Max items per embedding API call
  FRAUD_SCORE_TIMEOUT_MS: 2_000,
  RECOMMENDATION_TIMEOUT_MS: 5_000,
  MAX_HISTORY_DEPTH: 50, // Last N items for user embedding
  COLD_START_MIN_INTERACTIONS: 5, // Below this: use popularity
} as const;

export const AI_CACHE_TTL = {
  USER_EMBEDDING: 3600, // 1 hour — recompute when user acts
  PRODUCT_EMBEDDING: 86400, // 24 hours — stable
  RECOMMENDATIONS: 300, // 5 min — refresh periodically
  FRAUD_SCORE: 60, // 1 min — time-sensitive
  TRENDING_PRODUCTS: 600, // 10 min
} as const;

export const AI_CACHE_KEYS = {
  userEmbedding: (userId: string) => `ai:embed:user:${userId}`,
  productEmbedding: (productId: string) => `ai:embed:product:${productId}`,
  recommendations: (userId: string) => `ai:reco:${userId}`,
  fraudScore: (userId: string) => `ai:fraud:${userId}`,
  trending: (window: string) => `ai:trending:${window}`,
  similarProducts: (productId: string) => `ai:similar:${productId}`,
} as const;

export const AI_KAFKA_TOPICS = {
  USER_INTERACTION: 'ai.user.interaction',
  RECOMMENDATION_COMPUTED: 'ai.recommendation.computed',
  FRAUD_DETECTED: 'ai.fraud.detected',
  EMBEDDING_READY: 'ai.embedding.ready',
} as const;

export const FRAUD_THRESHOLDS = {
  /** Score >= HIGH_RISK → block transaction */
  HIGH_RISK: 0.8,
  /** Score >= MEDIUM_RISK → require 3DS/OTP */
  MEDIUM_RISK: 0.5,
  /** Score < LOW_RISK → allow without extra checks */
  LOW_RISK: 0.3,
} as const;
