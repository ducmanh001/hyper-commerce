---
description: Shared NestJS libraries and cross-cutting patterns — libs/common, libs/database, libs/events, libs/kafka, libs/queue, libs/redis. NestJS module conventions, TypeORM, DTOs, error handling.
applyTo: 'libs/common/**,libs/database/**,libs/events/**,libs/kafka/**,libs/queue/**,libs/redis/**,libs/tracing/**,libs/grpc/**'
---

# Shared Libs Agent — Cross-Cutting Patterns & Libraries

## CONTEXT (read once, reuse)

You are working on shared libraries used by ALL 13 NestJS microservices in HyperCommerce.
**Any change here affects every service** — be conservative, add @deprecated before removing.

## Key Shared Libraries

> Module/controller/service patterns → see `nestjs.instructions.md`

```typescript
// libs/kafka — event publishing
import { KafkaProducerService } from '@app/kafka';
// Usage:
await this.kafka.publish('topic.name', { correlationId: uuid(), ...payload });

// libs/redis — cache + Lua atomics
import { RedisClientService } from '@app/redis';

// libs/database — base entity
import { BaseEntity } from '@app/database';
// BaseEntity has: id (UUID), createdAt, updatedAt, deletedAt

// libs/events — typed Kafka schemas
import { OrderCreatedEvent } from '@app/events';
```

## Saga Pattern (Choreography)

```
order.created  → [inventory] reserve stock
stock.reserved → [payment] charge card
payment.captured → [order] confirm order → [notification] send email
payment.failed → [order] cancel → [inventory] release stock
```

- Each service consumes exactly its own events
- Compensating event on failure = reverse the action + publish failure event
- `correlationId` propagated through ALL events for tracing

## TypeORM Patterns

> Guards/DTOs patterns → see `nestjs.instructions.md`

```typescript
// Transactions — use QueryRunner for multi-table writes
const qr = this.dataSource.createQueryRunner();
await qr.connect();
await qr.startTransaction();
try {
  await qr.manager.save(entity);
  await qr.commitTransaction();
} catch (e) {
  await qr.rollbackTransaction();
  throw e;
} finally {
  await qr.release();
}

// Soft delete — never hard delete user data
await this.repo.softDelete(id);
```

## Outbox Pattern (REQUIRED for Kafka publishes)

```typescript
// WRONG — dual-write risk
await this.orderRepo.save(order);
await this.kafka.publish('order.created', event); // could fail after save

// CORRECT — outbox in same transaction
await qr.manager.save(order);
await qr.manager.save(OutboxEvent, { topic: 'order.created', payload: event });
// Debezium CDC picks up outbox row → publishes to Kafka atomically
```

## Error Handling

```typescript
// Use typed errors from libs/common
throw new BusinessException(ErrorCode.STOCK_INSUFFICIENT, 'Not enough stock', HttpStatus.CONFLICT);
throw new BusinessException(ErrorCode.VOUCHER_EXPIRED, 'Voucher expired', HttpStatus.BAD_REQUEST);
```

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
