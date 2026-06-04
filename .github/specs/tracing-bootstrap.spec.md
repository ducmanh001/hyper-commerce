---
feature: TracingModule Bootstrap — 9 Services
domain: '@backend'
level: L2
status: READY
created: 2026-06-05
related-fe: none
---

# TracingModule Bootstrap — Wire OpenTelemetry into 9 Services

## Goal

`libs/tracing/src/tracing.module.ts` đã implement đầy đủ OTel nhưng không service nào import → distributed tracing mù hoàn toàn. Wire vào 9 services.

## Read First

- `libs/tracing/src/tracing.module.ts` ← TracingModule.forRoot() API
- `libs/tracing/src/index.ts` ← exports

## Acceptance Criteria

- [ ] AC1: 9 services import TracingModule — traces xuất hiện trong Jaeger/OTLP
- [ ] AC2: `OTEL_EXPORTER_OTLP_ENDPOINT` từ env var — không hardcode
- [ ] AC3: `npx tsc --noEmit` = 0 errors
- [ ] AC4: Service name trong trace = tên service (vd: `user-service`)

## Domain Rules

- `OTEL_EXPORTER_OTLP_ENDPOINT` từ `process.env` — never hardcode URL
- TracingModule là `@Global()` — import một lần trong AppModule là đủ
- Mỗi service truyền `serviceName` của nó

## Tasks

Add `TracingModule.forRoot({ serviceName: 'X' })` vào AppModule imports của:

1. `apps/user-service/src/app.module.ts` — serviceName: 'user-service'
2. `apps/order-service/src/app.module.ts` — serviceName: 'order-service'
3. `apps/payment-service/src/app.module.ts` — serviceName: 'payment-service'
4. `apps/inventory-service/src/app.module.ts` — serviceName: 'inventory-service'
5. `apps/feed-service/src/app.module.ts` — serviceName: 'feed-service'
6. `apps/live-service/src/live.module.ts` — serviceName: 'live-service'
7. `apps/notification-service/src/app.module.ts` — serviceName: 'notification-service'
8. `apps/search-service/src/app.module.ts` — serviceName: 'search-service'
9. `apps/ai-service/src/app.module.ts` — serviceName: 'ai-service'

## Edge Cases

- TracingModule forRoot() không tồn tại → read module file trước, dùng đúng API
- Module đã import TracingModule → skip (idempotent)

## Skip

- wallet-service, subscription-service, chat-service, review-service, ads-service (add separately)
- Jaeger/OTLP collector docker-compose setup (separate infra spec)
- Custom span instrumentation (separate task)

## Fragments

+base +verify-L2
