import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  IPaymentProcessor,
  ChargeResult,
  RefundResult,
} from './interfaces/payment-processor.interface';

/**
 * StripeProcessor — Stripe payment gateway integration.
 *
 * Uses Stripe PaymentIntents API (not deprecated Charges).
 * Supports SCA (Strong Customer Authentication) for EU.
 * Idempotency via Stripe-Idempotency-Key header.
 */
@Injectable()
export class StripeProcessor implements IPaymentProcessor {
  readonly processorType = 'STRIPE';
  private readonly logger = new Logger(StripeProcessor.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY', 'sk_test_placeholder'), {
      apiVersion: '2024-06-20',
    });
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  async charge(params: {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethodToken: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChargeResult> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: params.amount,
          currency: params.currency.toLowerCase(),
          payment_method: params.paymentMethodToken,
          confirm: true,
          return_url: this.config.get<string>(
            'STRIPE_RETURN_URL',
            'https://app.hypercommerce.vn/payment/complete',
          ),
          metadata: {
            orderId: params.orderId,
            ...(params.metadata as Record<string, string>),
          },
        },
        { idempotencyKey: params.idempotencyKey },
      );

      if (intent.status === 'succeeded') {
        return {
          processorReference: intent.id,
          status: 'CAPTURED',
          capturedAt: new Date(),
          rawResponse: { stripeStatus: intent.status },
        };
      }

      if (intent.status === 'requires_action') {
        // 3DS required — return PENDING, client handles redirect
        return {
          processorReference: intent.id,
          status: 'PENDING',
          rawResponse: {
            stripeStatus: intent.status,
            nextActionUrl: intent.next_action?.redirect_to_url?.url,
          },
        };
      }

      return { processorReference: intent.id, status: 'FAILED' };
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        this.logger.warn(`Stripe card declined: ${err.code} — ${err.message}`);
        return {
          processorReference: '',
          status: 'FAILED',
          rawResponse: { declineCode: err.decline_code, code: err.code },
        };
      }
      this.logger.error(`Stripe error: ${String(err)}`);
      throw err;
    }
  }

  async refund(params: {
    processorReference: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: params.processorReference,
        amount: params.amount,
        reason: 'requested_by_customer',
        metadata: { reason: params.reason },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return {
      refundReference: refund.id,
      status: refund.status === 'succeeded' ? 'REFUNDED' : 'PENDING_REFUND',
      processedAt: new Date(),
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    try {
      this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }
}
