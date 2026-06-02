// apps/payment-service/src/constants/payment.constants.ts

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  CHARGEBACK = 'CHARGEBACK',
}

export enum PaymentMethod {
  STRIPE = 'stripe',
  VNPAY = 'vnpay',
  MOMO = 'momo',
  COD = 'cod',
  ZALOPAY = 'zalopay',
  BANK_TRANSFER = 'bank_transfer',
}

export const PAYMENT_ERRORS = {
  NOT_FOUND: 'PAY_001',
  ALREADY_CAPTURED: 'PAY_002',
  INSUFFICIENT_FUNDS: 'PAY_003',
  CARD_DECLINED: 'PAY_004',
  GATEWAY_ERROR: 'PAY_005',
  REFUND_EXCEED_AMOUNT: 'PAY_006',
  DUPLICATE_PAYMENT: 'PAY_007',
  INVALID_WEBHOOK: 'PAY_008',
  UNSUPPORTED_METHOD: 'PAY_009',
} as const;

export const PAYMENT_FEES = {
  /** Stripe fee: 2.9% + 30 cents */
  STRIPE_RATE: 0.029,
  STRIPE_FIXED_CENTS: 30,
  /** VNPay domestic: 1.5% */
  VNPAY_RATE: 0.015,
  /** MoMo: 0.5% capped at 40,000 VND */
  MOMO_RATE: 0.005,
  MOMO_MAX_FEE_CENTS: 40_000_00,
  /** COD: 15,000 VND flat */
  COD_FEE_CENTS: 15_000_00,
  /** ZaloPay: 0.8% */
  ZALOPAY_RATE: 0.008,
} as const;

export const PAYMENT_TIMEOUTS = {
  /** VNPay redirect URL TTL */
  VNPAY_URL_TTL_MS: 15 * 60 * 1000,
  /** MoMo QR code TTL */
  MOMO_QR_TTL_MS: 5 * 60 * 1000,
  /** ZaloPay TTL */
  ZALOPAY_TTL_MS: 15 * 60 * 1000,
  /** Auto-cancel COD after 30 days unconfirmed */
  COD_AUTO_CANCEL_DAYS: 30,
} as const;

export const PAYMENT_CACHE_KEYS = {
  payment: (id: string) => `payment:${id}`,
  orderPayment: (orderId: string) => `payment:order:${orderId}`,
  webhookProcessed: (id: string) => `webhook:processed:${id}`,
  idempotency: (key: string) => `payment:idempotency:${key}`,
} as const;

export const PAYMENT_KAFKA_TOPICS = {
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_INITIATED: 'payment.initiated',
} as const;
