---
description: Shared NestJS libraries and cross-cutting patterns — libs/common, libs/database, libs/events, libs/kafka, libs/queue, libs/redis. NestJS module conventions, TypeORM, DTOs, error handling.
applyTo: 'libs/common/**,libs/database/**,libs/events/**,libs/kafka/**,libs/queue/**,libs/redis/**,libs/tracing/**,libs/grpc/**'
---

# Shared Libs Agent — Cross-Cutting Patterns & Libraries

## CONTEXT (read once, reuse)

You are working on shared libraries used by ALL 16 NestJS microservices in HyperCommerce.
**Any change here affects every service** — be conservative, add @deprecated before removing.

## Key Shared Libraries

| Lib      | Import path     | Patterns                                                         |
| -------- | --------------- | ---------------------------------------------------------------- |
| kafka    | `@app/kafka`    | `KafkaProducerService.publish(topic, payload)` — see `+kafka.md` |
| redis    | `@app/redis`    | `RedisClientService` — see `+redis.md`                           |
| database | `@app/database` | `BaseEntity` (id UUID, createdAt, updatedAt, deletedAt)          |
| events   | `@app/events`   | Typed schemas — see `libs/events/EVENTS.md`                      |
| queue    | `@app/queue`    | `QUEUE_CONSTANTS` — see `libs/queue/src/constants/`              |

## Saga Pattern (Choreography)

> Flow: see `copilot-instructions.md` Architecture Patterns
> Order-saga detail: see `agents/commerce.agent.md`

- Each service consumes exactly its own events
- Compensating event on failure = reverse the action + publish failure event
- `correlationId` propagated through ALL events for tracing

## TypeORM Patterns

> Multi-table transactions → use `+tx.md` fragment (QueryRunner pattern)
> Guards/DTOs/entity conventions → see `nestjs.instructions.md`
> Soft delete: `repo.softDelete(id)` — never hard delete user data

## Outbox Pattern (REQUIRED for Kafka publishes)

> Full pattern → see `+kafka.md` fragment
> Rule: save `OutboxEvent` in **same transaction** as business entity. NEVER dual-write.
> wallet-service + order-service use Outbox. Other services: direct publish OK.

## Error Handling

Use `BusinessException(ErrorCode.X, message, HttpStatus.Y)` from `libs/common`.
Error codes defined in `libs/common/src/exceptions/error-codes.ts`.

## Metrics

All services expose `/metrics` (prom-client). Add `Counter`/`Histogram` per key operation.
Labels: `status`, `paymentMethod`, `channel`, `type` — see `infrastructure/monitoring/prometheus.yml`.

## Redis Key Naming

```
inv:stock:{productId}:{variantId}     stock counter
inv:reserve:{reservationId}           reservation (TTL=900s = 15min)
order:lock:{idempotencyKey}           distributed lock (TTL=10s)
voucher:usage:count:{voucherId}       atomic usage counter
wallet:coins:{userId}                 gift coin balance
hc:price:{productId}:{variantId}      price cache (TTL=60s)
```

## Services Map

| Service              | Port | Domain Agent      |
| -------------------- | ---- | ----------------- |
| order-service        | 3003 | commerce.agent.md |
| payment-service      | 3007 | commerce.agent.md |
| inventory-service    | 3004 | commerce.agent.md |
| user-service         | 3001 | social.agent.md   |
| feed-service         | 3002 | social.agent.md   |
| live-service         | 3006 | social.agent.md   |
| subscription-service | 3013 | social.agent.md   |
| notification-service | 3008 | platform.agent.md |
| analytics-service    | 3009 | platform.agent.md |
| admin-service        | 3011 | platform.agent.md |
| ads-service          | 3012 | platform.agent.md |
| ai-service           | 3010 | ai-ml.agent.md    |
| search-service       | 3005 | ai-ml.agent.md    |
