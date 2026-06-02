// ============================================================
// HYPERCOMMERCE — Queue Constants
// Centralized queue/job names — never hardcode in service files
// ============================================================

export const QUEUE_NAMES = {
  // Order processing
  ORDER_PROCESSING: 'order:processing',
  ORDER_SAGA_COMPENSATION: 'order:saga:compensation',

  // Payment
  PAYMENT_CHARGE: 'payment:charge',
  PAYMENT_REFUND: 'payment:refund',
  PAYMENT_WEBHOOK: 'payment:webhook',

  // Notification
  NOTIFICATION_EMAIL: 'notification:email',
  NOTIFICATION_SMS: 'notification:sms',
  NOTIFICATION_PUSH: 'notification:push',
  NOTIFICATION_IN_APP: 'notification:in-app',

  // Feed
  FEED_FANOUT: 'feed:fanout',
  FEED_RERANK: 'feed:rerank',

  // Search
  SEARCH_INDEX: 'search:index',
  SEARCH_BULK_INDEX: 'search:bulk-index',

  // AI/ML
  AI_RECOMMENDATION: 'ai:recommendation',
  AI_FRAUD_CHECK: 'ai:fraud-check',
  AI_EMBEDDING_GENERATE: 'ai:embedding-generate',

  // Analytics
  ANALYTICS_INGEST: 'analytics:ingest',

  // Media
  MEDIA_RESIZE: 'media:resize',
  MEDIA_THUMBNAIL: 'media:thumbnail',

  // Stock
  STOCK_RECONCILE: 'stock:reconcile',
  STOCK_SYNC: 'stock:sync',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  // Order
  CREATE_ORDER: 'create-order',
  CANCEL_ORDER: 'cancel-order',
  COMPENSATE_STOCK: 'compensate-stock',
  COMPENSATE_PAYMENT: 'compensate-payment',

  // Payment
  CHARGE_STRIPE: 'charge-stripe',
  CHARGE_VNPAY: 'charge-vnpay',
  CHARGE_MOMO: 'charge-momo',
  PROCESS_REFUND: 'process-refund',
  HANDLE_WEBHOOK: 'handle-webhook',

  // Notification
  SEND_ORDER_CONFIRMATION: 'send-order-confirmation',
  SEND_PAYMENT_RECEIPT: 'send-payment-receipt',
  SEND_SHIP_UPDATE: 'send-ship-update',
  SEND_PROMO: 'send-promo',
  SEND_OTP: 'send-otp',

  // Feed
  FANOUT_POST: 'fanout-post',
  CELEBRITY_FANOUT: 'celebrity-fanout',
  FEED_CLEANUP: 'feed-cleanup',

  // Search
  INDEX_PRODUCT: 'index-product',
  BULK_REINDEX: 'bulk-reindex',
  DELETE_FROM_INDEX: 'delete-from-index',

  // AI
  COMPUTE_RECOMMENDATIONS: 'compute-recommendations',
  SCORE_FRAUD: 'score-fraud',
  GENERATE_EMBEDDINGS: 'generate-embeddings',
  BATCH_RERANK: 'batch-rerank',

  // Stock
  RECONCILE_STOCK: 'reconcile-stock',
  RELEASE_EXPIRED_RESERVATIONS: 'release-expired-reservations',
} as const;

export type JobName = typeof JOB_NAMES[keyof typeof JOB_NAMES];

// Default job options per queue type
export const JOB_DEFAULT_OPTIONS = {
  // Critical jobs — retry 3x, remove on fail=false (inspect failed jobs)
  CRITICAL: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: { count: 1000, age: 86400 }, // keep 24h
    removeOnFail: false,
  },

  // Non-critical (notifications, analytics) — retry 5x, remove on fail
  NON_CRITICAL: {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 2000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 604800 }, // keep failed 7 days
  },

  // Best-effort (feed, search indexing) — retry 2x
  BEST_EFFORT: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },

  // Delayed jobs (scheduled tasks)
  SCHEDULED: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
} as const;

// Concurrency settings per queue
export const QUEUE_CONCURRENCY = {
  [QUEUE_NAMES.ORDER_PROCESSING]: 50,
  [QUEUE_NAMES.PAYMENT_CHARGE]: 100,
  [QUEUE_NAMES.PAYMENT_REFUND]: 20,
  [QUEUE_NAMES.NOTIFICATION_EMAIL]: 200,
  [QUEUE_NAMES.NOTIFICATION_SMS]: 100,
  [QUEUE_NAMES.NOTIFICATION_PUSH]: 500,
  [QUEUE_NAMES.FEED_FANOUT]: 50,
  [QUEUE_NAMES.SEARCH_INDEX]: 200,
  [QUEUE_NAMES.AI_RECOMMENDATION]: 20,
  [QUEUE_NAMES.AI_FRAUD_CHECK]: 50,
  [QUEUE_NAMES.ANALYTICS_INGEST]: 500,
  [QUEUE_NAMES.STOCK_RECONCILE]: 10,
} as const;
