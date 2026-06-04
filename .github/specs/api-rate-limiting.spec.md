---
feature: API Rate Limiting — Gateway + Critical Endpoints
domain: '@backend'
level: L2
status: READY
created: 2026-06-05
related-fe: none
---

# API Rate Limiting — Gateway + Critical Endpoints

## Goal

Chỉ SMS có rate limit. Thêm rate limiting vào API gateway và 2 endpoints quan trọng nhất để chống abuse.

## Read First

- `apps/api-gateway/server.js`
- `apps/order-service/src/order.controller.ts`
- `apps/user-service/src/user.controller.ts` ← login endpoint
- `infrastructure/postgres/SCHEMA.md` ← Redis key patterns

## Acceptance Criteria

- [ ] AC1: API gateway: IP-based 100 req/15min cho public routes
- [ ] AC2: `POST /orders` — user-based 10 orders/min, return 429 nếu exceed
- [ ] AC3: `POST /auth/login` — IP-based 5 attempts/15min, return 429 nếu exceed
- [ ] AC4: Rate limit headers: `X-RateLimit-Remaining`, `Retry-After`
- [ ] AC5: Health check endpoints `/health` không bị rate limit

## Domain Rules

- Gateway: dùng `express-rate-limit` package (check package.json trước)
- order-service: Redis INCR pattern — `order:rl:{userId}` TTL=60s max=10
- login: Redis INCR — `auth:rl:{ip}` TTL=900s (15min) max=5
- Nếu key exist và over limit → return HTTP 429 với `Retry-After` header
- Follow pattern từ SMS rate limit trong `sms.channel.ts`

## Tasks

1. `apps/api-gateway/server.js` — add `express-rate-limit` middleware (skip `/health*`, `/metrics`)
2. `OrderController.createOrder()` — middleware check `order:rl:{userId}` trước handler
3. `UserController.login()` — middleware check `auth:rl:{ip}` (dùng `req.ip`)
4. Trả về response đúng format: `{ statusCode: 429, message: 'Too Many Requests', retryAfter: N }`

## Edge Cases

- Trusted internal IPs (K8s pod range) → bypass gateway rate limit (add TRUSTED_IPS env var)
- Redis down → fail-open (allow request, log warning) — rate limit không được block traffic khi Redis down

## Skip

- Per-seller rate limiting
- Dynamic rate limits theo tier (ENTERPRISE gets higher limits) — phase 2
- Redis Cluster sliding window (fixed window đủ cho MVP)

## Fragments

+base +redis +verify-L2
