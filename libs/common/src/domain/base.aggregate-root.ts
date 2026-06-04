/**
 * BaseAggregateRoot — Aggregate Root with Domain Events
 *
 * WHY: An Aggregate Root is the top-level entity of a cluster of related objects.
 *      You ONLY access the cluster through the root (e.g., add items to Order,
 *      not directly to OrderItem).
 *
 * DOMAIN EVENTS pattern:
 *   1. Business method mutates state AND calls addDomainEvent()
 *   2. Application handler FIRST persists in a transaction
 *   3. AFTER transaction commits, handler calls collectDomainEvents()
 *      and publishes to Kafka/EventEmitter
 *
 * WHY collect-then-publish (not publish-inside-handler):
 *   - Ensures events are published ONLY if persistence succeeded
 *   - No partial state: no event without a matching DB row
 *   - Enables transactional outbox pattern later
 *
 * RULE: Aggregate boundaries define consistency boundaries.
 *       Items within an aggregate are ALWAYS consistent with each other.
 *       Cross-aggregate consistency is EVENTUAL (via events).
 */
import { BaseEntity } from './base.entity';
import type { DomainEvent } from './domain-event.base';

export abstract class BaseAggregateRoot extends BaseEntity {
  private readonly _domainEvents: DomainEvent[] = [];

  protected constructor(id?: string, createdAt?: Date, updatedAt?: Date) {
    super(id, createdAt, updatedAt);
  }

  /**
   * Record a domain event — called inside business methods.
   * Events accumulate during a unit of work, then get published after commit.
   */
  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /**
   * Drain the event list — called by the application layer AFTER persistence.
   * Clears the buffer so the same aggregate can process more commands.
   */
  collectDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0; // Drain in-place (no GC pressure)
    return events;
  }

  get hasDomainEvents(): boolean {
    return this._domainEvents.length > 0;
  }

  get domainEventCount(): number {
    return this._domainEvents.length;
  }
}
