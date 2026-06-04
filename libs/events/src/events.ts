// ============================================================
// libs/events — Domain Event Schemas
// All Kafka event contracts are defined here.
// Shared by producer and consumer services.
// BACKWARDS COMPATIBILITY RULE: Never remove/rename fields.
// Only add optional fields.
// ============================================================

// ── Base ─────────────────────────────────────────────────────
export interface DomainEvent {
  eventId: string; // UUID — idempotency key for consumers
  eventType: string;
  occurredAt: string; // ISO-8601
  traceId: string; // OpenTelemetry trace propagation
  version: number; // Schema version for migration
}

// ── Order Events ─────────────────────────────────────────────
export interface OrderCreatedEvent extends DomainEvent {
  eventType: 'ORDER_CREATED';
  orderId: string;
  userId: string;
  sellerId?: string;
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
  }>;
  totalAmount: number;
  currency: string;
  expiresAt: string; // Reservation TTL — cancel if payment not done
}

export interface OrderCancelledEvent extends DomainEvent {
  eventType: 'ORDER_CANCELLED';
  orderId: string;
  userId: string;
  reason: string;
  cancelledAt: string;
}

export interface OrderConfirmedEvent extends DomainEvent {
  eventType: 'ORDER_CONFIRMED';
  orderId: string;
  userId: string;
  confirmedAt: string;
}

// ── Stock Events ──────────────────────────────────────────────
export interface StockReservedEvent extends DomainEvent {
  eventType: 'STOCK_RESERVED';
  orderId: string;
  reservationIds: string[]; // Per-item reservation IDs for rollback
  expiresAt: string; // Reservation expiry (15 minutes default)
}

export interface StockReleasedEvent extends DomainEvent {
  eventType: 'STOCK_RELEASED';
  orderId: string;
  reservationIds: string[];
  reason: 'PAYMENT_FAILED' | 'ORDER_CANCELLED' | 'RESERVATION_EXPIRED';
}

export interface StockInsufficientEvent extends DomainEvent {
  eventType: 'STOCK_INSUFFICIENT';
  orderId: string;
  productId: string;
  variantId?: string;
  requested: number;
  available: number;
}

export interface StockLowEvent extends DomainEvent {
  eventType: 'STOCK_LOW';
  productId: string;
  variantId?: string;
  sellerId: string;
  currentStock: number;
  threshold: number;
}

// ── Payment Events ────────────────────────────────────────────
export interface PaymentInitiatedEvent extends DomainEvent {
  eventType: 'PAYMENT_INITIATED';
  orderId: string;
  userId: string;
  paymentId: string;
  amount: number;
  currency: string;
  processorType: string;
}

export interface PaymentCapturedEvent extends DomainEvent {
  eventType: 'PAYMENT_CAPTURED';
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  processorReference: string;
  capturedAt: string;
}

export interface PaymentFailedEvent extends DomainEvent {
  eventType: 'PAYMENT_FAILED';
  orderId: string;
  paymentId: string;
  declineCode: string;
  reason: string;
  retryable: boolean;
}

export interface RefundProcessedEvent extends DomainEvent {
  eventType: 'REFUND_PROCESSED';
  orderId: string;
  paymentId: string;
  refundAmount: number;
  currency: string;
  processedAt: string;
}

// ── User Events ───────────────────────────────────────────────
export interface UserRegisteredEvent extends DomainEvent {
  eventType: 'USER_REGISTERED';
  userId: string;
  email: string;
  username: string;
  registeredAt: string;
}

export interface UserFollowedEvent extends DomainEvent {
  eventType: 'USER_FOLLOWED';
  followerId: string;
  followeeId: string;
  isCelebrity: boolean; // triggers push to feed vs pull model
}

// ── Notification Events ───────────────────────────────────────
export interface NotificationRequestedEvent extends DomainEvent {
  eventType: 'NOTIFICATION_REQUESTED';
  userId: string;
  notificationType: string;
  channels: string[];
  data: Record<string, unknown>;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
}

// ── Live Events ───────────────────────────────────────────────
export interface LiveStreamStartedEvent extends DomainEvent {
  eventType: 'LIVE_STREAM_STARTED';
  streamId: string;
  hostId: string;
  title: string;
  scheduledProductIds: string[];
}

export interface LiveStreamEndedEvent extends DomainEvent {
  eventType: 'LIVE_STREAM_ENDED';
  streamId: string;
  hostId: string;
  peakViewers: number;
  totalRevenue: number;
  durationSeconds: number;
}

// ── Review Events ─────────────────────────────────────────────
export interface ReviewCreatedEvent extends DomainEvent {
  eventType: 'REVIEW_CREATED';
  reviewId: string;
  userId: string;
  productId: string;
  orderId: string;
  sellerId: string;
  rating: number; // 1-5
  /** AI moderation decision — set after async processing */
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface ReviewPublishedEvent extends DomainEvent {
  eventType: 'REVIEW_PUBLISHED';
  reviewId: string;
  productId: string;
  sellerId: string;
  rating: number;
  /** New aggregate stats after this review */
  newAverageRating: number;
  totalReviewCount: number;
}

export interface ReviewRejectedEvent extends DomainEvent {
  eventType: 'REVIEW_REJECTED';
  reviewId: string;
  userId: string;
  productId: string;
  reason: string;
}

export interface ReviewHelpfulMarkedEvent extends DomainEvent {
  eventType: 'REVIEW_HELPFUL_MARKED';
  reviewId: string;
  userId: string;
  newHelpfulCount: number;
}
