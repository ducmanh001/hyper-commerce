// ============================================================
// HYPERCOMMERCE — Order State Machine
// Finite State Machine for order lifecycle.
// Enforces valid transitions — prevents invalid state jumps.
//
// States: PENDING → STOCK_RESERVED → PAYMENT_PROCESSING → CONFIRMED
//                ↘              ↘                       ↘
//              CANCELLED      CANCELLED             REFUNDED
//
// Each transition maps to a Saga compensation action if reversed.
// ============================================================

import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

export type OrderStatus = keyof typeof APP_CONSTANTS.ORDER_STATUS;
export type OrderTransition = string;

interface TransitionRule {
  from: OrderStatus[];
  to: OrderStatus;
  compensatedBy?: OrderTransition; // What undoes this transition
}

// All valid transitions — anything not listed is FORBIDDEN
const TRANSITION_RULES: Record<string, TransitionRule> = {
  RESERVE_STOCK: {
    from: ['PENDING'],
    to: 'STOCK_RESERVED',
    compensatedBy: 'RELEASE_STOCK',
  },
  RELEASE_STOCK: {
    from: ['STOCK_RESERVED'],
    to: 'CANCELLED',
  },
  BEGIN_PAYMENT: {
    from: ['STOCK_RESERVED'],
    to: 'PAYMENT_PROCESSING',
    compensatedBy: 'REFUND_PAYMENT',
  },
  CONFIRM_PAYMENT: {
    from: ['PAYMENT_PROCESSING'],
    to: 'CONFIRMED',
  },
  FAIL_PAYMENT: {
    from: ['PAYMENT_PROCESSING'],
    to: 'CANCELLED',
  },
  REFUND_PAYMENT: {
    from: ['CONFIRMED'],
    to: 'REFUNDED',
  },
  CANCEL_PENDING: {
    from: ['PENDING', 'STOCK_RESERVED'],
    to: 'CANCELLED',
  },
  SHIP: {
    from: ['CONFIRMED'],
    to: 'SHIPPED',
  },
  DELIVER: {
    from: ['SHIPPED'],
    to: 'DELIVERED',
  },
  DISPUTE: {
    from: ['DELIVERED', 'CONFIRMED'],
    to: 'DISPUTED',
  },
  RESOLVE_DISPUTE: {
    from: ['DISPUTED'],
    to: 'DELIVERED',
  },
};

export class OrderStateмашина {
  constructor(private currentStatus: OrderStatus) {}

  canTransition(transition: OrderTransition): boolean {
    const rule = TRANSITION_RULES[transition];
    if (!rule) return false;
    return rule.from.includes(this.currentStatus);
  }

  transition(transition: OrderTransition): OrderStatus {
    const rule = TRANSITION_RULES[transition];
    if (!rule) {
      throw new Error(`Unknown transition: ${transition}`);
    }
    if (!rule.from.includes(this.currentStatus)) {
      throw new Error(
        `Invalid transition '${transition}' from status '${this.currentStatus}'. ` +
          `Valid from: ${rule.from.join(', ')}`,
      );
    }

    this.currentStatus = rule.to;
    return this.currentStatus;
  }

  getStatus(): OrderStatus {
    return this.currentStatus;
  }

  getCompensation(transition: OrderTransition): OrderTransition | null {
    return TRANSITION_RULES[transition]?.compensatedBy ?? null;
  }

  isTerminal(): boolean {
    return ['CANCELLED', 'REFUNDED', 'DELIVERED'].includes(this.currentStatus);
  }

  getValidTransitions(): OrderTransition[] {
    return Object.entries(TRANSITION_RULES)
      .filter(([, rule]) => rule.from.includes(this.currentStatus))
      .map(([transition]) => transition);
  }
}
