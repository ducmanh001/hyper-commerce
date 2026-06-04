// apps/order-service/src/state-machine/order-state-machine.ts
// Validates and applies order status transitions.
// Extracted from order.service.ts to keep each file focused.

import { OrderStatus, ORDER_TRANSITIONS, ORDER_ERRORS } from '../constants/order.constants';

export class InvalidOrderTransitionError extends Error {
  readonly code = ORDER_ERRORS.INVALID_STATUS_TRANSITION;
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot transition order from ${from} to ${to}`);
    this.name = 'InvalidOrderTransitionError';
  }
}

export class OrderStateMachine {
  /**
   * Returns true if the transition from → to is valid.
   */
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Asserts transition is valid. Throws InvalidOrderTransitionError otherwise.
   */
  assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidOrderTransitionError(from, to);
    }
  }

  /**
   * Get all valid next statuses from a given status.
   */
  getValidTransitions(from: OrderStatus): OrderStatus[] {
    return ORDER_TRANSITIONS[from] ?? [];
  }

  /**
   * Returns true if the order is in a terminal state (no further transitions).
   */
  isTerminal(status: OrderStatus): boolean {
    return this.getValidTransitions(status).length === 0;
  }

  /**
   * Returns true if the order can still be cancelled by the user.
   */
  isCancellableByUser(status: OrderStatus): boolean {
    return (
      this.canTransition(status, OrderStatus.CANCELLED) &&
      status !== OrderStatus.SHIPPED &&
      status !== OrderStatus.DELIVERED
    );
  }
}
