// apps/search-service/src/constants/search.constants.ts

export const SEARCH_ERRORS = {
  EMPTY_QUERY: 'SEARCH_001',
  INDEX_UNAVAILABLE: 'SEARCH_002',
  VECTOR_STORE_ERROR: 'SEARCH_003',
  RATE_LIMITED: 'SEARCH_004',
  INVALID_FILTER: 'SEARCH_005',
} as const;

export const SEARCH_LIMITS = {
  MAX_QUERY_LENGTH: 500,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE_SIZE: 20,
  MAX_FILTERS: 20,
  MIN_QUERY_LENGTH: 1,
  AUTOCOMPLETE_LIMIT: 10,
  VECTOR_CANDIDATES: 200, // retrieve 200 for RRF, show top 20
  BM25_CANDIDATES: 200,
  ES_CANDIDATES: 200,
} as const;

export const SEARCH_CACHE_TTL = {
  RESULTS_HOT: 60, // 1 min for trending queries
  RESULTS_NORMAL: 300, // 5 min for regular queries
  AUTOCOMPLETE: 600, // 10 min for autocomplete
  TRIE_SNAPSHOT: 3600, // 1 hour for trie snapshot in Redis
  VECTOR_EMBEDDING: 86400, // 24 hours for product embeddings
} as const;

export const SEARCH_CACHE_KEYS = {
  queryResult: (hash: string) => `search:result:${hash}`,
  autocomplete: (prefix: string) => `search:autocomplete:${prefix}`,
  trieSnapshot: () => 'search:trie:snapshot',
  embedding: (productId: string) => `search:embed:${productId}`,
  trending: (window: string) => `search:trending:${window}`,
  popularQueries: () => 'search:popular:queries',
} as const;

export const SEARCH_INDEX_NAMES = {
  PRODUCTS: 'hypercommerce_products',
  USERS: 'hypercommerce_users',
  POSTS: 'hypercommerce_posts',
} as const;

/** RRF k constant — increasing reduces impact of rank differences */
export const RRF_K = 60;

/** Boost factors for different signals */
export const SEARCH_BOOSTS = {
  TITLE_EXACT: 10,
  TITLE_FUZZY: 5,
  DESCRIPTION: 2,
  TAGS: 3,
  BRAND_EXACT: 8,
  FLASH_SALE: 1.5, // 50% boost for flash sale items
  HIGH_RATING: 1.3, // 30% boost for 4.5+ star items
  LOW_STOCK: 0.8, // 20% penalty for low stock (<5)
  OUT_OF_STOCK: 0, // Filter out OOS
} as const;
