---
feature: Health Check Endpoints — All Services
domain: '@backend'
level: L2
status: READY
created: 2026-06-05
related-fe: none
---

# Health Check /health Endpoints — All Services

## Goal

Không service nào có `/health` endpoint → K8s liveness/readiness probe không hoạt động, ops mù. Thêm health check vào 9 core services.

## Read First

- `package.json` — kiểm tra `@nestjs/terminus` đã có chưa
- `apps/user-service/src/app.module.ts` — pattern module import để follow

## Acceptance Criteria

- [ ] AC1: `GET /health/live` → `{ status: "ok" }` (no dependency check) — K8s liveness
- [ ] AC2: `GET /health/ready` → check DB + Redis + Kafka → K8s readiness
- [ ] AC3: `/health/ready` trả 503 nếu bất kỳ dep nào fail
- [ ] AC4: Endpoint không bị rate limited (xem api-rate-limiting spec)

## Domain Rules

- `@nestjs/terminus` — check package.json, nếu chưa có thì add
- `TypeOrmHealthIndicator` cho DB | `MicroserviceHealthIndicator` hoặc custom cho Redis/Kafka
- `/health/live` không check external deps — luôn trả 200 nếu process alive
- `/health/ready` check: PostgreSQL ping + Redis ping

## Tasks

Add `HealthModule` vào 9 services:

1. `apps/user-service/`
2. `apps/order-service/`
3. `apps/payment-service/`
4. `apps/inventory-service/`
5. `apps/feed-service/`
6. `apps/notification-service/`
7. `apps/search-service/`
8. `apps/wallet-service/`
9. `apps/subscription-service/`

Mỗi service:

- Tạo `health.controller.ts` với 2 endpoints
- Import `TerminusModule` + `TypeOrmModule` health check
- Register trong AppModule

## Skip

- Kafka health indicator (risky — Kafka check có thể false negative)
- Grafana dashboard for health (separate infra spec)
- Detailed component health (DB connection pool stats) — phase 2

## Fragments

+base +verify-L2
