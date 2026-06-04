# Kafka Event Catalog — Navigation Index

> **Payload interfaces live in `libs/events/src/events.ts` — read that file, not this one.**
> This file stores only: (1) topic→service routing, (2) saga flow diagram, (3) rules.

## Topic → Service Routing

| Topic                 | Emitter           | Consumer(s)                                                                                 |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `order.events`        | order-service     | inventory-service, payment-service, notification-service, analytics-service, wallet-service |
| `inventory.events`    | inventory-service | order-service, notification-service                                                         |
| `payment.events`      | payment-service   | order-service, notification-service                                                         |
| `user.events`         | user-service      | notification-service, feed-service                                                          |
| `live.events`         | live-service      | feed-service, notification-service, analytics-service, wallet-service                       |
| `review.events`       | review-service    | ai-service, search-service, notification-service                                            |
| `notification.events` | any service       | notification-service                                                                        |
| `flash.events`        | inventory-service | feed-service, notification-service, analytics-service                                       |
| `wallet.events`       | wallet-service    | analytics-service                                                                           |
| `analytics.alerts`    | analytics-service | ops-agent (ai-service)                                                                      |

**Event interfaces**: `grep_search 'export interface.*Event' libs/events/src/events.ts`

---

## Saga: Order → Payment (choreography)

```
order-service         inventory-service      payment-service
     │                       │                      │
     │── ORDER_CREATED ──────►│                      │
     │                  STOCK_RESERVED ──────────────►│
     │                        │               PAYMENT_CAPTURED
     │◄────────── ORDER_CONFIRMED ──────────────────────│
     │
     │  On failure:
     │                  STOCK_INSUFFICIENT             │
     │◄── ORDER_CANCELLED ◄──────────────────          │
     │                       │◄── PAYMENT_FAILED ──────│
     │── ORDER_CANCELLED ────►│ (release stock)
```

---

## Dead Letter Topics

```
order.dead-letter | payment.dead-letter | inventory.dead-letter
```

Rule: log traceId + alert on-call + emit to ClickHouse `failed_events`

---

## Rules

- **Never remove/rename event fields** — only add optional fields (backwards compat)
- After adding a new emit: add interface to `events.ts` + add row to routing table above
- Kafka publish pattern (always include traceId + version):
  ```typescript
  await this.kafka.publish({
    topic,
    partitionKey: userId,
    value: {
      eventId: uuid(),
      eventType: 'X',
      occurredAt: new Date().toISOString(),
      traceId: uuid(),
      version: 1,
      ...payload,
    },
  });
  ```
