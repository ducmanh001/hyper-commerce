// ============================================================
// HYPERCOMMERCE — Agent Task Types & Base Interfaces
//
// Defines the shared contract between all agents.
// Every agent processes AgentTask and returns AgentResult.
// ============================================================

export enum AgentType {
  FRAUD = 'fraud',
  RECOMMEND = 'recommend',
  SUPPORT = 'support',
  OPS = 'ops',
  ANALYTICS = 'analytics',
  MODERATION = 'moderation',
  SEARCH_RANK = 'search_rank',
}

export enum TaskPriority {
  CRITICAL = 0, // Fraud detection — blocks order
  HIGH = 1, // Real-time recommendations
  NORMAL = 2, // Support responses
  LOW = 3, // Background analytics
}

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

export interface AgentTask<TInput = unknown> {
  taskId: string;
  type: AgentType;
  priority: TaskPriority;
  input: TInput;
  correlationId: string;
  userId?: string;
  sessionId?: string;
  /** ISO 8601 — task creation time */
  createdAt: string;
  /** Max milliseconds to complete before timeout */
  timeoutMs: number;
  /** Retry count (max 3) */
  retryCount: number;
}

export interface AgentResult<TOutput = unknown> {
  taskId: string;
  type: AgentType;
  status: TaskStatus;
  output?: TOutput;
  error?: string;
  /** Tool calls made during processing */
  toolCallsCount: number;
  /** Total tokens used (if LLM involved) */
  tokensUsed?: number;
  /** Processing duration in ms */
  durationMs: number;
  completedAt: string;
}

// ── Fraud Task ────────────────────────────────────────────────

export interface FraudTaskInput {
  orderId: string;
  userId: string;
  amount: number;
  ipAddress: string;
  deviceFingerprint: string;
  paymentMethod: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  billingCity: string;
  shippingCity: string;
}

export interface FraudTaskOutput {
  decision: 'PASS' | 'REVIEW' | 'BLOCK';
  score: number; // 0.0 - 1.0
  reasons: string[]; // human-readable flags
  rulesFired: string[]; // which rules triggered
  mlScore?: number; // LightGBM model score
}

// ── Recommendation Task ───────────────────────────────────────

export interface RecommendTaskInput {
  userId: string;
  context: 'home_feed' | 'product_detail' | 'cart' | 'post_purchase';
  /** Product being viewed (for product_detail context) */
  referenceProductId?: string;
  limit: number;
  excludeProductIds?: string[];
}

export interface RecommendTaskOutput {
  recommendations: Array<{
    productId: string;
    score: number;
    reason: 'collaborative' | 'content' | 'trending' | 'new';
  }>;
  strategy: 'two_tower' | 'popularity' | 'cold_start';
  fromCache: boolean;
}

// ── Support Task ──────────────────────────────────────────────

export interface SupportTaskInput {
  userId: string;
  sessionId: string;
  message: string;
  /** Chat history (last 10 turns max) */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  language: 'vi' | 'en';
}

export interface SupportTaskOutput {
  reply: string;
  intent: string; // detected user intent
  actionsPerformed: string[]; // e.g. ['looked_up_order', 'initiated_refund']
  escalatedToHuman: boolean;
  suggestedFAQs?: string[];
}

// ── Ops Task ──────────────────────────────────────────────────

export interface OpsTaskInput {
  trigger: 'alert' | 'schedule' | 'manual';
  alertName?: string;
  severity?: 'critical' | 'warning' | 'info';
  context?: Record<string, unknown>;
}

export interface OpsTaskOutput {
  analysis: string;
  actions: string[];
  runbookUrl?: string;
  autoResolved: boolean;
}

// ── Content Moderation Task ───────────────────────────────────

export type ContentType =
  | 'product_title'
  | 'product_description'
  | 'review'
  | 'live_chat'
  | 'seller_bio';

export interface ModerationTaskInput {
  contentId: string;
  contentType: ContentType;
  text: string;
  /** Optional image URLs for visual moderation */
  imageUrls?: string[];
  language: 'vi' | 'en' | 'auto';
}

export interface ModerationTaskOutput {
  decision: 'APPROVED' | 'FLAGGED' | 'REJECTED';
  /** 0.0 - 1.0, higher = more likely violating */
  toxicityScore: number;
  categories: Array<'spam' | 'offensive' | 'prohibited_goods' | 'misleading' | 'adult'>;
  /** Specific text spans that triggered flags */
  flaggedSpans: Array<{ text: string; category: string; start: number; end: number }>;
  /** Human review required? (FLAGGED items above threshold) */
  requiresHumanReview: boolean;
}

// ── Search Rank Task ─────────────────────────────────────────

export interface SearchRankTaskInput {
  query: string;
  userId?: string;
  /** BM25 + kNN candidates from Elasticsearch + Qdrant */
  candidates: Array<{
    productId: string;
    bm25Score: number;
    knnScore: number;
    rrfScore: number; // Reciprocal Rank Fusion pre-merged score
    fields: {
      title: string;
      category: string;
      price: number;
      salesCount: number;
      rating: number;
    };
  }>;
  limit: number;
  context?: 'search_page' | 'autocomplete' | 'category_browse';
}

export interface SearchRankTaskOutput {
  rankedProductIds: string[];
  /** Explains why top-3 items ranked high */
  topExplanations: Array<{ productId: string; reason: string }>;
  /** Model used for final ranking */
  rankerUsed: 'rrf_only' | 'cross_encoder' | 'personalized';
  fromCache: boolean;
}
