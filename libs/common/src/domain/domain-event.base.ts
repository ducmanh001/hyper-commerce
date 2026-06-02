/**
 * DomainEvent — Base class for all domain events
 *
 * WHY: Domain events capture "something that happened" in the domain.
 *      They enable loose coupling: the order service doesn't call the
 *      notification service directly — it emits an event, notification
 *      service subscribes independently.
 *
 * LIFECYCLE:
 *   1. Domain operation happens (e.g., order placed)
 *   2. Aggregate records a domain event internally
 *   3. Transaction commits → handler publishes events
 *   4. Consumers react asynchronously (Kafka, EventEmitter, etc.)
 *
 * NAMING CONVENTION: Past tense — "UserRegistered", "OrderPlaced", "PaymentFailed"
 */
import { randomUUID } from 'crypto';

export abstract class DomainEvent {
  /**
   * Unique event identifier — useful for idempotent event consumers
   * and for deduplication in message brokers.
   */
  readonly eventId: string;

  /**
   * When the event happened in the domain.
   * Not when it was published to Kafka — that's a different concern.
   */
  readonly occurredAt: Date;

  /**
   * Event type string — used for routing, serialization, and schema registry.
   * Convention: "{aggregate}.{event_name}" e.g., "user.registered"
   */
  abstract readonly eventType: string;

  /**
   * Which aggregate produced this event.
   * Critical for event sourcing and audit logs.
   */
  abstract readonly aggregateId: string;

  protected constructor() {
    this.eventId = randomUUID();
    this.occurredAt = new Date();
  }
}
