import { Injectable, Logger } from '@nestjs/common';
import type {
  IPaymentProcessor,
  ChargeResult,
  RefundResult,
} from './interfaces/payment-processor.interface';

/**
 * CodProcessor — Cash on Delivery handler.
 *
 * COD is ~50% of all e-commerce orders in Vietnam.
 * No actual charge happens at order time — capture on delivery confirmation.
 *
 * Flow:
 * 1. Order created with COD → charge() returns PENDING
 * 2. Logistics partner delivers → POSTs webhook → capture()
 * 3. Customer refuses → refund() is no-op (no money taken)
 */
@Injectable()
export class CodProcessor implements IPaymentProcessor {
  readonly processorType = 'COD';
  private readonly logger = new Logger(CodProcessor.name);

  async charge(params: {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethodToken: string;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    // COD: no upfront charge — just record intent
    this.logger.log(`COD order ${params.orderId} — payment deferred to delivery`);
    return {
      processorReference: `cod_${params.idempotencyKey}`,
      status: 'PENDING',
      rawResponse: { note: 'COD payment will be collected on delivery' },
    };
  }

  /**
   * Called when logistics confirms delivery and cash collection.
   */
  async captureOnDelivery(orderId: string): Promise<ChargeResult> {
    this.logger.log(`COD captured for order ${orderId}`);
    return {
      processorReference: `cod_captured_${orderId}`,
      status: 'CAPTURED',
      capturedAt: new Date(),
    };
  }

  async refund(params: {
    processorReference: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    // COD: if not yet delivered → nothing to refund (no charge happened)
    // If delivered → issue store credit or bank transfer
    this.logger.log(`COD refund requested for ${params.processorReference} — ${params.reason}`);
    return {
      refundReference: `cod_refund_${params.idempotencyKey}`,
      status: 'PENDING_REFUND',
      processedAt: new Date(),
    };
  }

  verifyWebhookSignature(_payload: Buffer, _signature: string): boolean {
    // COD webhooks come from internal logistics service — validated by mTLS, not HMAC
    return true;
  }
}
