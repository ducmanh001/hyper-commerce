Kafka rules (apply when publishing or consuming Kafka events):

- Publish via Outbox pattern in wallet-service and order-service
- All other services: direct kafka.publish() with pattern from EVENTS.md
- Add new event interface to libs/events/src/events.ts
- Add new topic row to libs/events/EVENTS.md routing table
- Event payload MUST include: eventId | eventType | occurredAt | traceId | version
- partitionKey = userId for user-scoped events
