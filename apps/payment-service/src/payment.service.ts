// ============================================================
// HYPERCOMMERCE — Payment Service
// Strategy pattern cho multiple payment providers.
// Idempotent payment processing, webhook verification,
// automatic retry với exponential backoff.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import {
  PaymentDeclinedException,
  PaymentAlreadyProcessedException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import { Payment } from './entities/payment.entity';
import { PaymentProcessorFactory } from './processors/payment-processor.factory';
import { IdempotencyService } from '../../order-service/src/idempotency/idempotency.service';

export interface ChargeRequest {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: {
    type: 'CARD' | 'WALLET' | 'BANK_TRANSFER' | 'COD';
    token?: string;       // Stripe payment method ID
    walletId?: string;
  };
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  paymentId: string;
  status: 'CAPTURED' | 'PENDING' | 'FAILED';
  amount: number;
  currency: string;
  processorReference: string;
  capturedAt?: Date;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly kafka: KafkaProducerService,
    private readonly consumer: KafkaConsumerService,
    private readonly redis: RedisClientService,
    private readonly processorFactory: PaymentProcessorFactory,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.registerConsumer({
      groupId: 'payment-consumer',
      topics: [APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS],
      handlers: [
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
          handle: this.onPaymentInitiate.bind(this),
        },
      ],
    });
  }

  /**
   * Process a payment — idempotent.
   *
   * Critical: charge must happen exactly once even if:
   * - Network timeout causes retry
   * - Kafka delivers message twice
   * - Client retries on 5xx
   *
   * Idempotency key = orderId (globally unique per order)
   */
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    // ── Idempotency ───────────────────────────────────────
    const { result: cached, wasIdempotent } =
      await this.idempotency.withIdempotency<ChargeResult>(
        `payment:${req.idempotencyKey}`,
        async () => this.executeCharge(req),
      );

    if (wasIdempotent) {
      this.logger.log(
        JSON.stringify({
          event: 'payment_idempotent_hit',
          orderId: req.orderId,
          idempotencyKey: req.idempotencyKey,
        }),
      );
    }

    return cached;
  }

  async getPaymentByOrderId(orderId: string, _userId?: string) {
    return this.paymentRepo.findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Process refund — partial or full.
   * Refunds go to original payment method.
   */
  async refund(req: {
    paymentId: string;
    userId?: string;
    amount?: number;
    reason: string;
    idempotencyKey?: string;
  }): Promise<void> {
    const { paymentId, amount, reason } = req;
    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new Error(`Payment ${paymentId} not found`);

    const processor = this.processorFactory.getProcessor(payment.processorType as import('./processors/payment-processor.factory').PaymentMethodType);

    const refundAmount = amount ?? payment.amount;
    await processor.refund({
      processorReference: payment.processorReference ?? '',
      amount: refundAmount,
      reason,
      idempotencyKey: req.idempotencyKey ?? `refund:${payment.id}:${Date.now()}`,
    });

    await this.paymentRepo.update(paymentId, {
      refundedAmount: () => `refunded_amount + ${refundAmount}`,
      status: refundAmount >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    });

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_REFUNDED,
      partitionKey: payment.orderId,
      value: {
        type: 'PAYMENT_REFUNDED',
        paymentId,
        orderId: payment.orderId,
        amount: refundAmount,
        reason,
        refundedAt: new Date().toISOString(),
      },
    });
  }

  // ── Private ───────────────────────────────────────────────

  private async executeCharge(req: ChargeRequest): Promise<ChargeResult> {
    const processor = this.processorFactory.getProcessor(
      req.paymentMethod.type as import('./processors/payment-processor.factory').PaymentMethodType,
    );

    let processorResult: Awaited<ReturnType<typeof processor.charge>>;

    try {
      processorResult = await processor.charge({
        orderId: req.orderId,
        amount: req.amount,
        currency: req.currency,
        paymentMethodToken: req.paymentMethod.token ?? '',
        metadata: {
          userId: req.userId,
          ...req.metadata,
        },
        idempotencyKey: req.idempotencyKey,
      });
    } catch (error) {
      const declineCode =
        error instanceof Error ? error.message : 'UNKNOWN';

      // Store failed payment record
      await this.paymentRepo.save({
        orderId: req.orderId,
        userId: req.userId,
        amount: req.amount,
        currency: req.currency,
        status: 'FAILED',
        processorType: req.paymentMethod.type,
        processorReference: '',
        failureCode: declineCode,
      });

      await this.kafka.publish({
        topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_FAILED,
        partitionKey: req.orderId,
        value: {
          type: 'PAYMENT_FAILED',
          orderId: req.orderId,
          declineCode,
          reason: declineCode,
        },
      });

      throw new PaymentDeclinedException(req.orderId, declineCode);
    }

    // Payment captured
    const payment = await this.paymentRepo.save({
      orderId: req.orderId,
      userId: req.userId,
      amount: req.amount,
      currency: req.currency,
      status: 'CAPTURED',
      processorType: req.paymentMethod.type,
      processorReference: processorResult.processorReference ?? '',
      capturedAt: new Date(),
    });

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_CAPTURED,
      partitionKey: req.orderId,
      value: {
        type: 'PAYMENT_CAPTURED',
        paymentId: payment.id,
        orderId: req.orderId,
        amount: req.amount,
        currency: req.currency,
        capturedAt: payment.capturedAt?.toISOString(),
      },
    });

    return {
      paymentId: payment.id,
      status: 'CAPTURED',
      amount: req.amount,
      currency: req.currency,
      processorReference: processorResult.processorReference ?? '',
      capturedAt: payment.capturedAt,
    };
  }

  private async onPaymentInitiate(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    if (event.type !== 'PAYMENT_INITIATE') return;

    // Fetch order details to get payment method
    // In production: PaymentService maintains its own payment_methods table
    this.logger.log(
      JSON.stringify({
        event: 'payment_initiate_received',
        orderId: event.orderId,
        traceId: meta.traceId,
      }),
    );
  }
}
