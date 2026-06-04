/**
 * UserEventPublisher — Kafka adapter implementing IUserEventPublisherPort
 *
 * Maps domain events to Kafka topics and publishes them.
 *
 * TOPIC STRATEGY:
 *   One topic per aggregate type: "user.events"
 *   The event type is in the message header.
 *   Consumers filter by eventType in the message payload.
 *
 *   Alternative: one topic per event type ("user.registered", "user.followed")
 *   Tradeoff: more topics = more partitions = more overhead, but simpler consumers.
 *   We use single-topic + eventType field because user events have low volume
 *   and most consumers care about multiple event types.
 *
 * ORDERING:
 *   Kafka preserves order within a partition.
 *   We use userId as the partition key → all events for the same user go
 *   to the same partition → correct event ordering per user.
 *
 * RETRY ON FAILURE:
 *   If Kafka publish fails, we log the error.
 *   In production, use the Transactional Outbox Pattern:
 *   1. Write event to an "outbox" table IN THE SAME DB TRANSACTION as the save
 *   2. A relay process reads the outbox and publishes to Kafka
 *   This guarantees at-least-once delivery with exactly-once semantics.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import type { DomainEvent } from '@hypercommerce/common/domain/domain-event.base';
import type { IUserEventPublisherPort } from '../../application/ports/application.ports';

const TOPIC = 'user.events';

@Injectable()
export class UserEventPublisher implements IUserEventPublisherPort {
  private readonly logger = new Logger(UserEventPublisher.name);

  constructor(private readonly kafka: KafkaProducerService) {}

  async publish(event: DomainEvent): Promise<void> {
    try {
      await this.kafka.publish({
        topic: TOPIC,
        key: event.aggregateId, // Partition by aggregate ID
        value: {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt.toISOString(),
          payload: event as unknown as Record<string, unknown>,
        },
        headers: {
          'event-type': event.eventType,
          'aggregate-id': event.aggregateId,
          'event-id': event.eventId,
        },
      });
    } catch (err) {
      // Log but don't throw — event publishing failure shouldn't rollback the command
      // In production: write to outbox table instead
      this.logger.error({
        event: 'kafka_publish_failed',
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        error: String(err),
      });
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    await Promise.allSettled(events.map((e) => this.publish(e)));
  }
}
