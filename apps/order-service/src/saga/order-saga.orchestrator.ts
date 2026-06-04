// ============================================================
// HYPERCOMMERCE — Order Saga Orchestrator (Choreography)
// Listens to Kafka events, orchestrates state transitions,
// triggers compensating transactions on failure.
//
// Choreography pattern: NO central orchestrator — each service
// reacts to events independently. OrderService is just one actor.
//
// Event chain:
// [OrderService] order.created
//   → [InventoryService] stock.reserved OR stock.insufficient
//     → [PaymentService] payment.captured OR payment.failed
//       → [OrderService] update status, emit confirmation
//         → [NotificationService] send confirmation/failure
//
// Compensation chain (reverse):
// payment.failed
//   → [OrderService] order.cancelled
//     → [InventoryService] stock.released
//       → [NotificationService] send cancellation
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { OrderService } from '../order.service';

interface StockReservedEvent {
  type: 'STOCK_RESERVED';
  orderId: string;
  reservationIds: string[];
  expiresAt: string;
}

interface StockInsufficientEvent {
  type: 'STOCK_INSUFFICIENT';
  orderId: string;
  productId: string;
  requested: number;
  available: number;
}

interface PaymentCapturedEvent {
  type: 'PAYMENT_CAPTURED';
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  capturedAt: string;
}

interface PaymentFailedEvent {
  type: 'PAYMENT_FAILED';
  orderId: string;
  declineCode: string;
  reason: string;
}

@Injectable()
export class OrderSagaOrchestrator implements OnModuleInit {
  private readonly logger = new Logger(OrderSagaOrchestrator.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly producer: KafkaProducerService,
    private readonly orderService: OrderService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Register Kafka consumers for all Saga events
    await this.consumer.registerConsumer({
      groupId: 'order-saga-consumer',
      topics: [
        APP_CONSTANTS.KAFKA_TOPICS.STOCK_RESERVED,
        APP_CONSTANTS.KAFKA_TOPICS.STOCK_INSUFFICIENT,
        APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_CAPTURED,
        APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_FAILED,
      ],
      handlers: [
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.STOCK_RESERVED,
          handle: this.onStockReserved.bind(this) as unknown as (
            m: Record<string, unknown>,
            meta: MessageMetadata,
          ) => Promise<void>,
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.STOCK_INSUFFICIENT,
          handle: this.onStockInsufficient.bind(this) as unknown as (
            m: Record<string, unknown>,
            meta: MessageMetadata,
          ) => Promise<void>,
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_CAPTURED,
          handle: this.onPaymentCaptured.bind(this) as unknown as (
            m: Record<string, unknown>,
            meta: MessageMetadata,
          ) => Promise<void>,
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_FAILED,
          handle: this.onPaymentFailed.bind(this) as unknown as (
            m: Record<string, unknown>,
            meta: MessageMetadata,
          ) => Promise<void>,
        },
      ],
      maxRetries: 3,
      retryBackoffMs: 500,
    });
  }

  /**
   * Stock reserved successfully → initiate payment.
   *
   * Inventory has locked the stock (TTL reservation).
   * Now trigger payment processing.
   */
  private async onStockReserved(event: StockReservedEvent, meta: MessageMetadata): Promise<void> {
    this.logger.log(
      JSON.stringify({
        event: 'saga_stock_reserved',
        orderId: event.orderId,
        traceId: meta.traceId,
      }),
    );

    await this.orderService.transitionState(event.orderId, 'RESERVE_STOCK');

    // Trigger payment processing
    await this.producer.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
      partitionKey: event.orderId,
      value: {
        type: 'PAYMENT_INITIATE',
        orderId: event.orderId,
        reservationIds: event.reservationIds,
        expiresAt: event.expiresAt,
      },
      traceId: meta.traceId,
    });
  }

  /**
   * Stock insufficient → cancel order immediately.
   * Compensation: nothing to undo (stock was never reserved).
   */
  private async onStockInsufficient(
    event: StockInsufficientEvent,
    meta: MessageMetadata,
  ): Promise<void> {
    this.logger.warn(
      JSON.stringify({
        event: 'saga_stock_insufficient',
        orderId: event.orderId,
        productId: event.productId,
        traceId: meta.traceId,
      }),
    );

    await this.orderService.transitionState(event.orderId, 'CANCEL_PENDING');

    // Notify user of cancellation
    await this.publishOrderCancelled(event.orderId, 'INSUFFICIENT_STOCK', meta.traceId);
  }

  /**
   * Payment captured → confirm order.
   * This is the happy path completion of the Saga.
   */
  private async onPaymentCaptured(
    event: PaymentCapturedEvent,
    meta: MessageMetadata,
  ): Promise<void> {
    this.logger.log(
      JSON.stringify({
        event: 'saga_payment_captured',
        orderId: event.orderId,
        paymentId: event.paymentId,
        traceId: meta.traceId,
      }),
    );

    await this.orderService.transitionState(event.orderId, 'CONFIRM_PAYMENT');

    // Emit order confirmed — triggers notification + analytics
    await this.producer.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CONFIRMED,
      partitionKey: event.orderId,
      value: {
        type: 'ORDER_CONFIRMED',
        orderId: event.orderId,
        paymentId: event.paymentId,
        amount: event.amount,
        currency: event.currency,
        confirmedAt: new Date().toISOString(),
      },
      traceId: meta.traceId,
    });
  }

  /**
   * Payment failed → compensating transaction.
   *
   * Must reverse in correct order:
   * 1. Cancel order (OrderService)
   * 2. Release stock reservation (InventoryService — triggered by order.cancelled)
   * 3. Notify user (NotificationService — triggered by order.cancelled)
   *
   * IMPORTANT: We publish order.cancelled, NOT directly release stock.
   * Each service listens to events it owns — maintains loose coupling.
   */
  private async onPaymentFailed(event: PaymentFailedEvent, meta: MessageMetadata): Promise<void> {
    this.logger.warn(
      JSON.stringify({
        event: 'saga_payment_failed',
        orderId: event.orderId,
        declineCode: event.declineCode,
        traceId: meta.traceId,
      }),
    );

    await this.orderService.transitionState(event.orderId, 'FAIL_PAYMENT');

    // Publish cancellation — InventoryService listens and releases stock
    await this.publishOrderCancelled(
      event.orderId,
      `PAYMENT_DECLINED:${event.declineCode}`,
      meta.traceId,
    );
  }

  private async publishOrderCancelled(
    orderId: string,
    reason: string,
    traceId: string,
  ): Promise<void> {
    await this.producer.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CANCELLED,
      partitionKey: orderId,
      value: {
        type: 'ORDER_CANCELLED',
        orderId,
        reason,
        cancelledAt: new Date().toISOString(),
      },
      traceId,
    });
  }

  /**
   * Start the saga for a newly created order.
   * Publishes order.created event to kick off stock reservation.
   */
  async start(orderId: string, order: Record<string, unknown>): Promise<void> {
    await this.producer.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CREATED,
      partitionKey: orderId,
      value: {
        type: 'ORDER_CREATED',
        orderId,
        order,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Compensate a saga — release stock and trigger refund if needed.
   */
  async compensate(orderId: string, ctx: { reason: string; initiatedBy: string }): Promise<void> {
    await this.producer.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CANCELLED,
      partitionKey: orderId,
      value: {
        type: 'ORDER_CANCELLED',
        orderId,
        reason: ctx.reason,
        initiatedBy: ctx.initiatedBy,
        cancelledAt: new Date().toISOString(),
      },
    });
  }
}
