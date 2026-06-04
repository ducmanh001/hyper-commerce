// apps/order-service/src/commands/handlers/cancel-order.handler.ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CancelOrderCommand } from '../cancel-order.command';
import type { OrderRepository } from '../../repositories/order.repository';
import type { OrderStateMachine } from '../../state-machine/order-state-machine';
import type { OrderSagaOrchestrator } from '../../saga/order-saga.orchestrator';
import { ORDER_ERRORS, OrderStatus } from '../../constants/order.constants';

export class OrderNotCancellableError extends Error {
  readonly code = ORDER_ERRORS.INVALID_STATUS_TRANSITION;
  constructor(orderId: string, status: string) {
    super(`Order ${orderId} in status ${status} cannot be cancelled`);
    this.name = 'OrderNotCancellableError';
  }
}

export class OrderNotOwnedByUserError extends Error {
  constructor() {
    super('Order does not belong to the requesting user');
    this.name = 'OrderNotOwnedByUserError';
  }
}

@Injectable()
export class CancelOrderHandler {
  private readonly logger = new Logger(CancelOrderHandler.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly stateMachine: OrderStateMachine,
    private readonly sagaOrchestrator: OrderSagaOrchestrator,
  ) {}

  async execute(cmd: CancelOrderCommand): Promise<void> {
    const order = await this.repo.findById(cmd.orderId);
    if (!order) {
      throw new NotFoundException(`Order ${cmd.orderId} not found`);
    }

    // Authorization: user can only cancel their own orders
    if (cmd.initiatedBy === 'user' && order.userId !== cmd.userId) {
      throw new OrderNotOwnedByUserError();
    }

    if (!this.stateMachine.isCancellableByUser(order.status as OrderStatus)) {
      throw new OrderNotCancellableError(cmd.orderId, order.status);
    }

    // Transition to CANCELLED
    this.stateMachine.assertTransition(order.status as OrderStatus, OrderStatus.CANCELLED);

    await this.repo.updateStatus(cmd.orderId, OrderStatus.CANCELLED, {
      cancelledAt: new Date(),
      cancellationReason: cmd.reason,
      cancelledBy: cmd.userId,
    });

    // Trigger saga compensation: release stock + refund if payment was captured
    await this.sagaOrchestrator.compensate(cmd.orderId, {
      reason: cmd.reason,
      initiatedBy: cmd.initiatedBy,
    });

    this.logger.log(
      `Order ${cmd.orderId} cancelled by ${cmd.initiatedBy}:${cmd.userId} — reason: ${cmd.reason}`,
    );
  }
}
