---
feature: Flash Sale Engine
domain: '@commerce'
level: L4
status: TODO
created: 2026-06-05
related-fe: apps/web/src/app/flash-sale/[id]/page.tsx (cần tạo)
---

# Flash Sale Engine — Distributed Atomic Purchase

## Goal

Flash sale cần atomic stock deduction tránh oversell. Lua script là core — mọi deduction đi qua 1 Redis call duy nhất.

## Read First

- `infrastructure/postgres/SCHEMA.md` ← next migration number
- `libs/events/EVENTS.md` ← flash.events topic
- `apps/inventory-service/src/` ← stock management pattern
- `libs/queue/src/constants/queue.constants.ts` ← FLASH_SALE_PROCESS constant

## Acceptance Criteria

- [ ] AC1: Lua script atomic — `DECR stock → check user limit → INCRBY sold` trong 1 Redis call
- [ ] AC2: 0 oversell khi concurrent load (test với 100 concurrent requests, stock=10)
- [ ] AC3: `FlashSaleTickService` broadcast countdown mỗi 1s qua Socket.IO
- [ ] AC4: Rate limit `/purchase` — 5 req/user/sec, 429 + Retry-After
- [ ] AC5: `FlashSaleCampaign` `activatedAt` + TTL = source of truth, không rely clock client

## Domain Rules

- Lua script là **ONLY** way deduct stock — không bao giờ 2 Redis calls riêng lẻ
- `per_user_limit` enforce trong Lua server-side — không trust quantity từ client
- `flash:stock:{id}` SETEX TTL = sale duration → auto-expire khi sale kết thúc
- Giá VND: BIGINT, không float
- BullMQ `FLASH_SALE_PROCESS` job: validate window → call order-service → restore stock nếu order fail

## Tasks

### Entities + Migration

1. `FlashSaleCampaign` entity: `{ startsAt, endsAt, discountPercent, status }`
2. `FlashSaleItem` entity: `{ campaignId, productId, originalPrice BIGINT, salePrice BIGINT, flashStock, soldStock }`
3. Migration `N_flash_sales.sql` — check SCHEMA.md cho migration number

### Core Services

4. Lua script `flash-sale.lua`: `DECR flash:stock:{id}` → check user limit `flash:user:{userId}:{id}` → `INCRBY flash:sold:{id} 1`
5. `FlashSaleService.activateSale()`: load stock → `SETEX flash:stock:{id}` TTL=duration; schedule BullMQ expire job
6. `FlashSaleService.attemptPurchase()`: run Lua → enqueue `FLASH_SALE_PROCESS` job → return optimistic result
7. `FlashSaleProcessor`: validate window → call order-service → on success INCR sold_stock PG; on fail restore Redis stock
8. `FlashSaleTickService` (OnModuleInit): `setInterval 1s` per active sale → broadcast `flash:tick:{saleId}` Socket.IO

### API

9. 6 REST endpoints: `POST /flash-sales` | `PATCH /flash-sales/:id/items` | `POST /flash-sales/:id/activate` | `POST /flash-sales/:id/purchase` | `GET /flash-sales/:id` | `GET /flash-sales/:id/leaderboard`
10. Rate limit middleware: Redis `INCR flash:rl:{userId}` EXPIRE 1s → 429 nếu > 5

### Events + Queue

11. Add `FLASH_SALE_PROCESS` constant vào `queue.constants.ts`
12. Emit `FLASH_SALE_STARTED` / `FLASH_SALE_ENDED` to `flash.events` — update EVENTS.md
13. Add event interfaces to `libs/events/src/events.ts`

### Frontend

14. `apps/web/src/app/flash-sale/[id]/page.tsx`: `FlashSaleCountdown`, `StockProgressBar`, `BuyNowButton` + Socket.IO `flash:tick` subscription

## Kafka Events

```
flash.events:
  FLASH_SALE_STARTED: { campaignId, saleId, startedAt, itemCount }
  FLASH_SALE_ENDED:   { campaignId, saleId, endedAt, totalSold, revenue }
```

## Edge Cases

- User đã mua đủ `per_user_limit` → Lua trả -1 → 400 "Bạn đã đạt giới hạn mua"
- Sale chưa activated / đã expired → 409 trước khi chạy Lua
- Order service timeout → BullMQ retry 3 lần, sau đó restore stock

## Skip

- Campaign scheduling UI (admin page) — separate spec
- Analytics dashboard cho flash sale — analytics-service spec

## Fragments

+base +kafka +redis +tx +migration +verify-L4
