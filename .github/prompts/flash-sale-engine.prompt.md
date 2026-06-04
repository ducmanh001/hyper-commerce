---
description: Implement distributed Flash Sale engine
mode: agent
---

# Flash Sale Engine

> Spec: `infrastructure/postgres/SCHEMA.md` § flash-sale (migration 006)  
> Events: `libs/events/EVENTS.md` topics `flash.events`  
> Pattern: follow `apps/inventory-service/src/` for stock management conventions

## Checklist

- [ ] Read SCHEMA.md § flash-sale → write migration `006_flash_sales.sql` → update SCHEMA.md
- [ ] 2 entities: `FlashSaleCampaign`, `FlashSaleItem` (bigint prices, separate flash_stock from main stock)
- [ ] Lua script `flash-sale.lua`: atomic `DECR stock → check user limit → INCRBY sold` (single Redis call, no race)
- [ ] `FlashSaleService.activateSale()`: load stock → Redis `SETEX flash:stock:{id}` TTL=sale_duration; schedule EXPIRE job
- [ ] `FlashSaleService.attemptPurchase()`: run Lua → enqueue BullMQ `FLASH_SALE_PROCESS` job → return optimistic result
- [ ] `FlashSaleProcessor`: validate window → call order-service → on success INCR sold_stock in PG; on fail restore Redis stock
- [ ] Rate limit `/purchase`: 5 req/user/sec via Redis `INCR flash:rl:{userId}` EXPIRE 1s → 429 + Retry-After
- [ ] `FlashSaleTickService`: setInterval 1s per active sale → broadcast `flash:tick:{saleId}` via Socket.IO
- [ ] Add queue constants to `libs/queue/src/constants/queue.constants.ts`
- [ ] Emit `FLASH_SALE_STARTED`/`FLASH_SALE_ENDED` (see EVENTS.md for payloads)
- [ ] 6 REST endpoints: CRUD sale + addItem + purchase + leaderboard
- [ ] Frontend: `apps/web/src/app/flash-sale/[id]/page.tsx` — FlashSaleCountdown, StockProgressBar, BuyNowButton + Socket.IO integration

## Security (non-negotiable)

- Lua script is the ONLY way to decrement stock — never two separate Redis calls
- `per_user_limit` enforced in Lua server-side — never trust client-sent quantity
- All purchase endpoints: JWT required, UUID validation before Redis ops
