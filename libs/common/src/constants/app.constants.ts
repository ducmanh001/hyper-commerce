// ============================================================
// HYPERCOMMERCE — App-wide Constants
// ============================================================

export const APP_CONSTANTS = {
  // Kafka Topics — partition strategy documented alongside each
  KAFKA_TOPICS: {
    ORDER_CREATED: 'order-created', // 32 partitions, key=order_id
    ORDER_EVENTS: 'order-events', // 32 partitions, key=seller_id
    ORDER_CANCELLED: 'order-cancelled', // 32 partitions, key=order_id
    STOCK_RESERVED: 'stock-reserved', // 64 partitions, key=product_id
    STOCK_RELEASED: 'stock-released', // 64 partitions, key=product_id
    STOCK_INSUFFICIENT: 'stock-insufficient',
    PAYMENT_CAPTURED: 'payment-captured', // 32 partitions, key=order_id
    PAYMENT_FAILED: 'payment-failed',
    PAYMENT_REFUNDED: 'payment-refunded',
    ORDER_CONFIRMED: 'order-confirmed', // 32 partitions, key=user_id
    FEED_SIGNALS: 'feed-signals', // 128 partitions, key=user_id
    INVENTORY_DELTA: 'inventory-delta', // 64 partitions, key=product_id
    USER_FOLLOWED: 'user-followed', // 64 partitions, key=followee_id
    NOTIFICATION_DISPATCH: 'notification-dispatch',
    ANALYTICS_EVENTS: 'analytics-events', // 256 partitions, key=user_id
    SEARCH_INDEX_UPDATE: 'search-index-update',
    LIVE_EVENTS: 'live-events', // 64 partitions, key=stream_id
    FRAUD_SIGNALS: 'fraud-signals', // 32 partitions, key=user_id
    AI_INFERENCE_REQUEST: 'ai-inference-request',
  },

  // Redis key prefixes — namespaced to avoid collision
  REDIS_KEYS: {
    USER_SESSION: 'session:user:',
    USER_PROFILE: 'cache:user:',
    FEED_SCORE: 'feed:score:', // feed:score:{user_id}:{post_id}
    FEED_CURSOR: 'feed:cursor:', // feed:cursor:{user_id}
    PRODUCT_STOCK: 'inv:stock:', // inv:stock:{product_id}
    PRODUCT_RESERVED: 'inv:reserved:', // inv:reserved:{product_id}:{order_id}
    PRODUCT_CACHE: 'cache:product:',
    RATE_LIMIT: 'ratelimit:',
    IDEMPOTENCY: 'idem:', // idem:{idempotency_key}
    FLASH_SALE_QUEUE: 'flash:queue:', // flash:queue:{sale_id}
    FLASH_SALE_WINNERS: 'flash:win:',
    CART_RESERVATION: 'cart:reserve:', // cart:reserve:{user_id}:{product_id}
    OTP_CODE: 'otp:',
    STREAM_VIEWERS: 'live:viewers:', // live:viewers:{stream_id} → sorted set
    STREAM_METADATA: 'live:meta:',
    CELEBRITY_LIST: 'celebrity:ids', // set of celebrity user_ids
    SEARCH_SUGGEST: 'search:suggest:',
    LEADERBOARD: 'lb:',
    LOYALTY_POINTS: 'loyalty:points:',
    USER_ONLINE: 'online:', // online:{user_id} → TTL based
    CIRCUIT_BREAKER: 'cb:',
    FRAUD_SCORE: 'fraud:score:',
    // Feed ranking v1
    FEED_USER_EMBED: 'user:embed:', // user:embed:{userId} → float32 JSON array (768-dim)
    FEED_AB_VARIANT: 'feed:ab:', // feed:ab:{userId} → 'v1'|'v2' (TTL=7d)
    FEED_RANKED: 'feed:feat:user:', // feed:feat:user:{userId} → ranked JSON (TTL=300s)
  },

  // Follower thresholds
  CELEBRITY_FOLLOWER_THRESHOLD: 10_000,
  MEGA_CELEBRITY_THRESHOLD: 1_000_000,

  // Feed
  FEED_FETCH_LIMIT: 200, // raw posts fetched from Cassandra
  FEED_PAGE_SIZE: 20, // returned to client per page
  FEED_SCORE_TTL_SECONDS: 3_600, // 1 hour
  FEED_BUCKET_FORMAT: 'YYYYMM',

  // Inventory
  STOCK_RESERVE_TTL: 900, // 15 minutes (seconds)
  STOCK_RECONCILE_INTERVAL: 300_000, // 5 minutes (ms)
  FLASH_SALE_BATCH_SIZE: 100,

  // Order Saga state machine
  ORDER_STATUS: {
    PENDING: 'PENDING',
    STOCK_RESERVED: 'STOCK_RESERVED',
    PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
    SHIPPED: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    DISPUTED: 'DISPUTED',
  },

  // Idempotency
  IDEMPOTENCY_TTL: 86_400, // 24 hours

  // Rate limits per tier
  RATE_LIMITS: {
    FREE: { rpm: 60, burst: 20 },
    SELLER: { rpm: 300, burst: 100 },
    PREMIUM: { rpm: 1_000, burst: 300 },
    INTERNAL: { rpm: 10_000, burst: 1_000 },
  },

  // Circuit breaker thresholds
  CIRCUIT_BREAKER: {
    FAILURE_THRESHOLD: 5,
    SUCCESS_THRESHOLD: 2,
    HALF_OPEN_TIMEOUT: 30_000,
    OPEN_TIMEOUT: 60_000,
  },

  // ML Ranking weights (MUST sum to 1.0)
  FEED_RANKING_WEIGHTS: {
    engagement: 0.4,
    recency: 0.3,
    relationship: 0.2,
    diversity_penalty: 0.1,
  },

  // v1 linear scoring weights — from social.agent.md formula
  // Score = completionRate×0.30 + purchaseRate×0.20 + userInterest×0.20
  //        + decay×0.15 + shareRate×0.15
  FEED_RANK_WEIGHTS_V1: {
    completionRate: 0.3,
    purchaseRate: 0.2,
    userInterest: 0.2,
    decay: 0.15,
    shareRate: 0.15,
  },

  // v2 weights — favour purchase intent and sharing signal
  FEED_RANK_WEIGHTS_V2: {
    completionRate: 0.2,
    purchaseRate: 0.3,
    userInterest: 0.2,
    decay: 0.1,
    shareRate: 0.2,
  },

  // Feed cache TTL
  FEED_RANKED_TTL_SECONDS: 300, // 5 minutes (feed:feat:user:{userId})
  FEED_AB_TTL_SECONDS: 604_800, // 7 days  (feed:ab:{userId})

  // Search
  SEARCH_MAX_RESULTS: 1_000,
  SEARCH_VECTOR_DIMS: 768,
  SEARCH_KNN_CANDIDATES: 100, // ef_search for HNSW
  SEARCH_RRF_K: 60, // RRF constant (prevents dominance by top-1)

  // SLO targets
  SLO: {
    FEED_API_P99_MS: 80,
    ORDER_API_P99_MS: 3_000,
    SEARCH_API_P99_MS: 200,
    LIVE_API_P99_MS: 50,
  },
} as const;

export const MICROSERVICE_TOKENS = {
  USER_SERVICE: 'USER_SERVICE',
  FEED_SERVICE: 'FEED_SERVICE',
  ORDER_SERVICE: 'ORDER_SERVICE',
  INVENTORY_SERVICE: 'INVENTORY_SERVICE',
  SEARCH_SERVICE: 'SEARCH_SERVICE',
  PAYMENT_SERVICE: 'PAYMENT_SERVICE',
  NOTIFICATION_SERVICE: 'NOTIFICATION_SERVICE',
  ANALYTICS_SERVICE: 'ANALYTICS_SERVICE',
  AI_SERVICE: 'AI_SERVICE',
  LIVE_SERVICE: 'LIVE_SERVICE',
} as const;

export const INJECTION_TOKENS = {
  REDIS_CLIENT: 'REDIS_CLIENT',
  KAFKA_PRODUCER: 'KAFKA_PRODUCER',
  CASSANDRA_CLIENT: 'CASSANDRA_CLIENT',
  ES_CLIENT: 'ES_CLIENT',
  CLICKHOUSE_CLIENT: 'CLICKHOUSE_CLIENT',
} as const;
