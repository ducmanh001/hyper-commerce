---
feature: Fraud Detection — L1 Hard Rules Verify & Complete
domain: '@ai-ml'
level: L2
status: READY
created: 2026-06-05
related-fe: apps/web/src/app/admin/fraud/page.tsx (admin review queue)
related-admin: admin-service fraud review endpoint
---

# Fraud Detection — L1 Hard Rules Verify & Complete

## Goal

Verify và hoàn thiện 354-line fraud-detection.service.ts để L1 rules thực sự block/challenge orders, tích hợp vào order-service flow.

## Read First

- `apps/ai-service/src/fraud/fraud-detection.service.ts` ← 354 lines, kiểm tra từng rule
- `apps/order-service/src/order.service.ts` ← entry point cần gọi fraud check
- `libs/events/EVENTS.md` ← fraud.detected topic
- `libs/events/src/events.ts` ← FraudDetectedEvent nếu có

## Acceptance Criteria

- [ ] AC1: Velocity >10 orders/hr → BLOCK, không tạo order
- [ ] AC2: Device fingerprint mismatch (X-Device-Id header vs Redis stored) → CHALLENGE
- [ ] AC3: Score >0.7 → BLOCK | 0.4–0.7 → REVIEW | <0.4 → PASS
- [ ] AC4: BLOCK/REVIEW → emit `fraud.detected` Kafka event
- [ ] AC5: `fraud:block:{userId}` Redis (no TTL) → always block regardless of score
- [ ] AC6: order-service gọi fraud check trước khi tạo order

## Domain Rules

- L1 velocity: `fraud:velocity:{userId}` Redis INCR + EXPIRE 3600 → block if >10
- L1 device: header `X-Device-Id` vs `fraud:device:{userId}` Redis SET on first login
- L2 score: weighted rule approximation (no ONNX yet):
  - order_amount > 50M VND → +0.3
  - user_age_days < 7 → +0.25
  - device_count > 3 → +0.2
  - refund_rate > 0.3 → +0.25
- Cache score: `fraud:score:{userId}` TTL=3600
- Manual block: `fraud:block:{userId}` — no TTL, set by admin only

## Tasks

1. Read & verify all L1 rules in `fraud-detection.service.ts` — fill any gaps
2. Verify `FraudDetectionService.evaluate(orderId, userId, amount, deviceId, ip)` returns `FraudResult`
3. Wire into `OrderService.createOrder()` — call fraud check before DB write, throw if BLOCK
4. Ensure `fraud.detected` event emitted on BLOCK/REVIEW with correct payload
5. Add `FraudDetectedEvent` interface to `events.ts` if missing
6. Add `fraud.events` row to `EVENTS.md` if missing

## Kafka Events

```typescript
// ADD if missing in libs/events/src/events.ts
interface FraudDetectedEvent extends DomainEvent {
  eventType: 'FRAUD_DETECTED';
  orderId: string;
  userId: string;
  decision: 'BLOCK' | 'REVIEW';
  score: number;
  triggeredRules: string[];
}
```

## Edge Cases

- ai-service down → fail-open (PASS) with log warning — never block orders due to infra outage
- `fraud:block:{userId}` exists → BLOCK immediately, skip L1/L2 evaluation

## Skip

- L3 GNN Node2Vec graph analysis — premature
- ONNX LightGBM model — needs training data
- Admin unblock endpoint — see Related Admin
- FE fraud dashboard wiring — see Related FE

## Related Specs / FE

- Admin FE: `apps/web/src/app/admin/fraud/page.tsx` — fraud review queue
- Admin BE: `admin-service` needs `GET /admin/fraud/queue` endpoint (separate spec)

## Fragments

+base +kafka +verify-L2
