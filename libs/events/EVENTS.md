# Kafka Event Catalog

> **Source of truth**: `libs/events/src/events.ts`  
> Add new event interfaces there first, then add a row here.  
> **Rule**: never remove/rename existing fields — only add optional fields (backwards compat).

## All Topics & Events

| Topic                 | eventType                | Emitter           | Consumer(s)                                                      | Key Payload Fields                                             |
| --------------------- | ------------------------ | ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `order.events`        | `ORDER_CREATED`          | order-service     | inventory-service _(reserve)_, payment-service _(charge)_        | orderId, userId, items[], totalAmount, expiresAt               |
| `order.events`        | `ORDER_CONFIRMED`        | order-service     | notification-service, analytics-service                          | orderId, userId, confirmedAt                                   |
| `order.events`        | `ORDER_CANCELLED`        | order-service     | inventory-service _(release)_, notification-service              | orderId, userId, reason                                        |
| `inventory.events`    | `STOCK_RESERVED`         | inventory-service | order-service _(next saga step)_                                 | orderId, reservationIds[], expiresAt                           |
| `inventory.events`    | `STOCK_RELEASED`         | inventory-service | _(logging/analytics)_                                            | orderId, reservationIds[], reason                              |
| `inventory.events`    | `STOCK_INSUFFICIENT`     | inventory-service | order-service _(compensate → cancel)_                            | orderId, productId, requested, available                       |
| `inventory.events`    | `STOCK_LOW`              | inventory-service | notification-service _(alert seller)_                            | productId, sellerId, currentStock, threshold                   |
| `payment.events`      | `PAYMENT_INITIATED`      | payment-service   | _(processor webhook awaited)_                                    | orderId, paymentId, amount, processorType                      |
| `payment.events`      | `PAYMENT_CAPTURED`       | payment-service   | order-service _(confirm)_                                        | orderId, paymentId, amount, capturedAt                         |
| `payment.events`      | `PAYMENT_FAILED`         | payment-service   | order-service _(compensate)_, notification-service               | orderId, declineCode, retryable                                |
| `payment.events`      | `REFUND_PROCESSED`       | payment-service   | order-service, notification-service                              | orderId, refundAmount, processedAt                             |
| `user.events`         | `USER_REGISTERED`        | user-service      | notification-service _(welcome)_, feed-service _(init timeline)_ | userId, email, username                                        |
| `user.events`         | `USER_FOLLOWED`          | user-service      | feed-service _(fan-out or pull based on isCelebrity)_            | followerId, followeeId, isCelebrity                            |
| `notification.events` | `NOTIFICATION_REQUESTED` | **any service**   | notification-service                                             | userId, channels[], notificationType, data, priority           |
| `live.events`         | `LIVE_STREAM_STARTED`    | live-service      | feed-service _(push to followers)_, notification-service         | streamId, hostId, title, scheduledProductIds[]                 |
| `live.events`         | `LIVE_STREAM_ENDED`      | live-service      | analytics-service                                                | streamId, hostId, peakViewers, totalRevenue, durationSeconds   |
| `review.events`       | `REVIEW_CREATED`         | review-service    | ai-service _(moderation pipeline)_                               | reviewId, productId, orderId, rating, moderationStatus=PENDING |
| `review.events`       | `REVIEW_PUBLISHED`       | review-service    | search-service _(update rating)_, notification-service           | reviewId, productId, newAverageRating, totalReviewCount        |
| `review.events`       | `REVIEW_REJECTED`        | review-service    | notification-service _(inform user)_                             | reviewId, userId, reason                                       |
| `review.events`       | `REVIEW_HELPFUL_MARKED`  | review-service    | _(analytics)_                                                    | reviewId, userId, newHelpfulCount                              |

## Saga Choreography Flow (Order → Payment)

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

## Dead Letter Topics (add when needed)

```
order.dead-letter      — ORDER_CREATED that failed after 3 retries
payment.dead-letter    — PAYMENT_INITIATED that failed after 3 retries
inventory.dead-letter  — STOCK_RESERVED that failed after 3 retries
```

All DLT consumers must: log with traceId, alert on-call, emit to ClickHouse `failed_events`.
