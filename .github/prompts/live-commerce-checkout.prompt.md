---
description: Implement Live Commerce Checkout Flow
mode: agent
---

# Live Commerce Checkout Flow

> Spec: `infrastructure/postgres/SCHEMA.md` § live-service (migration 007)  
> Events: `libs/events/EVENTS.md` topics `live.events` (LIVE_PURCHASE_COMPLETED)  
> Pattern: extend `apps/live-service/src/live.gateway.ts` + `live.service.ts`  
> Depends on: wallet-service (port 3017) for gift coin flow

## Checklist

- [ ] Read SCHEMA.md § live-service → write migration `007_live_commerce.sql` → update SCHEMA.md
- [ ] 3 entities: `LivePinnedProduct`, `LiveGift`, `LiveCostreamSession`
- [ ] `LivePinService`: `pinProduct()` (unpin previous → SETEX Redis stock TTL=flash_duration → broadcast `live:product:pinned`), `unpinProduct()`
- [ ] `PinTickService` (OnModuleInit): `setInterval` 1s per pinned item → broadcast `live:pin:tick:{streamId}`; stop when TTL=0 or stock=0
- [ ] `LiveGiftService`: debit sender wallet (HTTP → wallet-service) → INSERT gift → credit host wallet (internal service call) → broadcast `live:gift:received`
- [ ] `LivePurchaseService`: DECR `live:pin:stock:{streamId}` → call order-service → broadcast `live:purchase:notify` (masked buyer name) → emit `LIVE_PURCHASE_COMPLETED`
- [ ] `CostreamService`: JWT invite token (5min TTL) → `acceptInvite` merges Socket.IO rooms → `splitRevenueOnEnd` on LIVE_STREAM_ENDED
- [ ] Add Socket.IO handlers to `live.gateway.ts`: `live:pin:product`, `live:unpin`, `live:send:gift`, `live:buy:pinned`, `live:costream:invite`, `live:costream:accept`
- [ ] All host-only socket actions: verify `userId === stream.hostId` server-side
- [ ] 7 REST endpoints (pin CRUD, gift leaderboard, host revenue, costream invite/accept)
- [ ] Frontend: extend `apps/web/src/app/live/[id]/page.tsx` → PinnedProductCard, GiftPanel, GiftLeaderboard, SocialProofToast

## Security (non-negotiable)

- Gift debit MUST succeed before INSERT gift row — never credit host before deducting from sender
- Buyer name mask mandatory in social proof: "Nguyen Van A" → "N**\***n"
- Costream invite = signed JWT — not random string
- Rate limit `live:send:gift`: 1 gift/user/2s
