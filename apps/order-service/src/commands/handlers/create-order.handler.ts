// apps/order-service/src/commands/handlers/create-order.handler.ts
// Handles CreateOrderCommand — orchestrates validation, factory, repo, saga.
// This is where ALL create-order logic lives; order.service.ts stays thin.

import { Injectable, Logger } from '@nestjs/common';
import { CreateOrderCommand } from '../create-order.command';
import { OrderFactory } from '../../factories/order.factory';
import { OrderStateMachine } from '../../state-machine/order-state-machine';
import { OrderRepository } from '../../repositories/order.repository';
import { OrderSagaOrchestrator } from '../../saga/order-saga.orchestrator';
import { ORDER_LIMITS, ORDER_ERRORS, ORDER_CACHE_KEYS } from '../../constants/order.constants';

export class EmptyOrderError extends Error {
  readonly code = ORDER_ERRORS.EMPTY_CART;
  constructor() {
    super('Order must contain at least one item');
    this.name = 'EmptyOrderError';
  }
}

export class MaxItemsExceededError extends Error {
  readonly code = ORDER_ERRORS.MAX_ITEMS_EXCEEDED;
  constructor() {
    super(`Order cannot exceed ${ORDER_LIMITS.MAX_ITEMS} items`);
    this.name = 'MaxItemsExceededError';
  }
}

@Injectable()
export class CreateOrderHandler {
  private readonly logger = new Logger(CreateOrderHandler.name);

  constructor(
    private readonly factory: OrderFactory,
    private readonly repo: OrderRepository,
    private readonly sagaOrchestrator: OrderSagaOrchestrator,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  async execute(cmd: CreateOrderCommand): Promise<{ orderId: string }> {
    // 1. Input validation
    if (!cmd.items || cmd.items.length === 0) {
      throw new EmptyOrderError();
    }
    if (cmd.items.length > ORDER_LIMITS.MAX_ITEMS) {
      throw new MaxItemsExceededError();
    }

    // 2. Idempotency check — prevent duplicate on retry
    if (cmd.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(cmd.idempotencyKey);
      if (existing) {
        this.logger.log(
          `Idempotent: returning existing order ${existing.id} for key ${cmd.idempotencyKey}`,
        );
        return { orderId: existing.id };
      }
    }

    // 3. Build order entity via factory (no DB call yet)
    const orderData = this.factory.createOrder({
      userId: cmd.userId,
      items: cmd.items,
      shippingAddress: cmd.shippingAddress,
      paymentMethod: cmd.paymentMethod,
      couponCode: cmd.couponCode,
      notes: cmd.notes,
    });

    // 4. Persist order in PENDING state — map factory OrderEntity → TypeORM Order
    const savedOrder = await this.repo.create({
      userId: orderData.userId,
      status: orderData.status as string as import('../../entities/order.entity').OrderStatus,
      totalAmount: orderData.totalCents,
      currency: orderData.currency,
      shippingAddress: orderData.shippingAddress as Record<string, string>,
      idempotencyKey: orderData.idempotencyKey,
      metadata: {
        subtotal: orderData.subtotalCents,
        shipping: orderData.shippingCents,
        discount: orderData.discountCents,
        paymentMethod: orderData.paymentMethod,
        couponCode: orderData.couponCode,
        notes: orderData.notes,
      },
    });

    this.logger.log(
      `Order ${savedOrder.id} created for user ${cmd.userId} — total ${savedOrder.totalAmount / 100} VND`,
    );

    // 5. Start Saga (async: reserve stock → charge payment → confirm order)
    // Fire-and-forget: saga publishes events, order status updated via callbacks
    this.sagaOrchestrator.start(savedOrder.id, savedOrder as unknown as Record<string, unknown>).catch((err: unknown) => {
      this.logger.error(`Saga failed to start for order ${savedOrder.id}`, err);
    });

    return { orderId: savedOrder.id };
  }
}
