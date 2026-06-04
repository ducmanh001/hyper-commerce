// apps/payment-service/src/processors/processor.interface.ts
// Contract that all payment processors must implement.

export interface ChargeResult {
  success: boolean;
  transactionId: string;
  gatewayReference?: string;
  amountCents: number;
  currency: string;
  /** ISO 8601 timestamp when charge was captured */
  capturedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Gateway-specific metadata (e.g., Stripe charge object) */
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  amountCents: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface PaymentChargeInput {
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  /** Payment method token (Stripe token, VNPay txn ref, etc.) */
  paymentToken?: string;
  /** Customer IP for fraud detection */
  ipAddress?: string;
  /** User agent for fraud scoring */
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface IPaymentProcessor {
  /** Human-readable name used in logs */
  readonly name: string;

  /** Initiate and capture a charge */
  charge(input: PaymentChargeInput): Promise<ChargeResult>;

  /** Refund a previously captured charge */
  refund(transactionId: string, amountCents: number, reason: string): Promise<RefundResult>;

  /** Validate a webhook payload. Returns parsed event or null if invalid. */
  validateWebhook(payload: Buffer, signature: string): Promise<Record<string, unknown> | null>;

  /** Calculate the processing fee for a given amount */
  calculateFee(amountCents: number): number;
}
