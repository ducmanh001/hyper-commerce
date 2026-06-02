// apps/order-service/src/constants/order.constants.ts
// Single source of truth for all order-service enums, thresholds, timeouts.

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

// Which transitions are valid (state machine edges)
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.FAILED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.FAILED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.FAILED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.FAILED]: [OrderStatus.CANCELLED],
};

export const ORDER_ERRORS = {
  NOT_FOUND: 'ORDER_001',
  INVALID_STATUS_TRANSITION: 'ORDER_002',
  INSUFFICIENT_STOCK: 'ORDER_003',
  PAYMENT_FAILED: 'ORDER_004',
  EMPTY_CART: 'ORDER_005',
  MAX_ITEMS_EXCEEDED: 'ORDER_006',
  SAGA_COMPENSATION_FAILED: 'ORDER_007',
  DUPLICATE_ORDER: 'ORDER_008',
} as const;

// Business limits
export const ORDER_LIMITS = {
  /** Max items per order */
  MAX_ITEMS: 50,
  /** Max quantity per single item */
  MAX_QUANTITY_PER_ITEM: 99,
  /** Max order value in cents */
  MAX_ORDER_VALUE_CENTS: 100_000_000, // 1M VND = 100,000,000 cents
  /** Minimum order value in cents */
  MIN_ORDER_VALUE_CENTS: 1_000,
  /** Stock reservation TTL (seconds) */
  RESERVATION_TTL_SECONDS: 600,
  /** Order pending timeout before auto-cancel */
  PENDING_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
} as const;

export const ORDER_CACHE_KEYS = {
  order: (id: string) => `order:${id}`,
  userOrders: (userId: string) => `orders:user:${userId}`,
  orderCount: (userId: string) => `order:count:user:${userId}`,
} as const;

export const ORDER_KAFKA_TOPICS = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  INVENTORY_RESERVE: 'inventory.stock.reserve',
  INVENTORY_RELEASE: 'inventory.stock.release',
  INVENTORY_COMMIT: 'inventory.stock.commit',
  PAYMENT_INITIATE: 'payment.initiate',
  PAYMENT_CANCEL: 'payment.cancel',
} as const;
