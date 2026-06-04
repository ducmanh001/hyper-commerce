/**
 * IPaymentProcessor — Strategy interface for all payment gateways.
 *
 * Each processor implements this interface:
 * - StripeProcessor
 * - VnpayProcessor
 * - MomoProcessor
 * - CodProcessor
 *
 * PaymentProcessorFactory selects the right one based on paymentMethod.type.
 * Adding a new gateway = add new class implementing this interface + register in factory.
 */
export interface ChargeResult {
  processorReference: string; // Gateway transaction ID
  status: 'CAPTURED' | 'PENDING' | 'FAILED';
  capturedAt?: Date;
  rawResponse?: Record<string, unknown>; // For audit logging
}

export interface RefundResult {
  refundReference: string;
  status: 'REFUNDED' | 'PENDING_REFUND';
  processedAt?: Date;
}

export interface IPaymentProcessor {
  readonly processorType: string;

  /**
   * Charge the customer.
   * - Idempotent: same idempotencyKey → same result, no double charge
   * - Throws PaymentDeclinedException on card decline
   * - Throws PaymentProcessorException on gateway error (retryable)
   */
  charge(params: {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethodToken: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChargeResult>;

  /**
   * Refund a captured payment.
   * Partial refunds supported (amount <= original).
   */
  refund(params: {
    processorReference: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<RefundResult>;

  /**
   * Verify webhook signature from processor.
   * Prevents spoofed webhook attacks.
   */
  verifyWebhookSignature(payload: Buffer, signature: string): boolean;
}
