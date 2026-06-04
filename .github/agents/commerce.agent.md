---
description: Commerce domain — order lifecycle, payment processing, inventory management. Tight coupling via Saga choreography.
applyTo: 'apps/order-service/**,apps/payment-service/**,apps/inventory-service/**,apps/review-service/**,apps/wallet-service/**'
---

# Commerce Agent — Order · Payment · Inventory

## Domain Boundary

These 3 services are tightly coupled via the order saga. Always consider all 3 when changing any.

```
order.created  → inventory: reserve stock (inv:stock DECR Lua)
stock.reserved → payment: charge card (strategy pattern)
payment.captured → order: confirm → notification: send
payment.failed  → order: cancel → inventory: release (INCR)
stock.insufficient → order: cancel immediately
```

## Outbox Pattern (MANDATORY for Kafka publishes)

```typescript
// All Kafka publishes in order-service go through outbox — never direct
const qr = this.dataSource.createQueryRunner();
await qr.connect();
await qr.startTransaction();
try {
  await qr.manager.save(Order, order);
  await qr.manager.save(OutboxEvent, {
    topic: 'order.created',
    aggregateType: 'Order',
    aggregateId: order.id,
    partitionKey: order.userId,
    payload: JSON.stringify(event),
  });
  await qr.commitTransaction();
} catch (e) {
  await qr.rollbackTransaction();
  throw e;
} finally {
  await qr.release();
}
// OutboxProcessorService polls every 500ms, exponential backoff on fail
```

## Inventory — 3-Tier Stock

```typescript
// Tier 1: Redis atomic DECR (Lua script — < 1ms)
// inv:stock:{productId}:{variantId}  → real-time counter
// inv:reserve:{reservationId}        → reservation TTL=900s (15 min!)

// Tier 2: PG reservation table — source of truth for settlement
// Tier 3: Reconciliation job syncs Redis ↔ PG every 5min

// NEVER call PG directly for stock check in hot path
// Always use RedisClientService.reserveStock() Lua script
```

## Payment — Strategy Pattern

```typescript
// apps/payment-service/src/strategies/
interface PaymentStrategy {
  charge(amount: number, currency: 'VND', metadata: PaymentMetadata): Promise<ChargeResult>;
  refund(transactionId: string, amount: number): Promise<RefundResult>;
  verifyWebhook(payload: Buffer, signature: string): boolean; // MUST verify before processing
}
// Implementations: StripeStrategy | VNPayStrategy | MoMoStrategy | CODStrategy
// Webhook endpoints MUST call strategy.verifyWebhook() before any processing
```

## Idempotency (order-service)

```typescript
// order:lock:{idempotencyKey}  Redis key, TTL=10s
// Check lock before processing, set lock before DB write
const lock = await this.redis.set(`order:lock:${dto.idempotencyKey}`, '1', 'EX', 10, 'NX');
if (!lock) throw new BusinessException(ErrorCode.DUPLICATE_REQUEST, ...);
```

## Key Redis Keys (Commerce)

```
inv:stock:{productId}:{variantId}     stock counter (atomic)
inv:reserve:{reservationId}           reservation (TTL=900s — NEVER skip TTL)
order:lock:{idempotencyKey}           distributed lock (TTL=10s)
voucher:usage:count:{voucherId}       atomic usage counter
hc:price:{productId}:{variantId}      price cache (TTL=60s)
```

## Kafka Events (Commerce)

> Canonical routing: `libs/events/EVENTS.md` — this table shows order-service domain perspective only.

| Publish         | Consume            |
| --------------- | ------------------ |
| order.created   | —                  |
| order.confirmed | —                  |
| order.shipped   | —                  |
| order.delivered | —                  |
| dispute.opened  | —                  |
| —               | stock.reserved     |
| —               | stock.insufficient |
| —               | payment.captured   |
| —               | payment.failed     |
| —               | payment.refunded   |

## Commission Calculation

```typescript
// commission = gmv × tier_rate
// tier_rate: FREE=3%, BASIC=2.5%, PRO=2%, ENTERPRISE=1.5%
// Stored in Commission entity, settled on order.delivered
```

## Error Codes (Commerce)

```typescript
ErrorCode.STOCK_INSUFFICIENT; // 409 Conflict
ErrorCode.PAYMENT_FAILED; // 402 Payment Required
ErrorCode.VOUCHER_EXPIRED; // 400 Bad Request
ErrorCode.DUPLICATE_REQUEST; // 409 Conflict
ErrorCode.ORDER_NOT_CANCELLABLE; // 422 Unprocessable
```
