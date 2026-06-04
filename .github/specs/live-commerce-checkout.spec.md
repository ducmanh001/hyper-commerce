---
feature: Live Commerce Checkout Flow
domain: '@social'
level: L4
status: TODO
created: 2026-06-05
related-fe: apps/web/src/app/live/[id]/page.tsx (extend — file đã có)
---

# Live Commerce Checkout Flow

## Goal

Live stream có pin product + real-time purchase + gift system. Mọi stock deduction dùng Redis atomic, gift debit từ wallet-service TRƯỚC khi insert gift row.

## Read First

- `infrastructure/postgres/SCHEMA.md` ← next migration number
- `libs/events/EVENTS.md` ← live.events topic
- `apps/live-service/src/live.gateway.ts` ← Socket.IO gateway pattern
- `apps/live-service/src/live.service.ts` ← existing service
- `apps/wallet-service/src/` ← wallet debit HTTP pattern

## Acceptance Criteria

- [ ] AC1: `pinProduct` atomic — unpin previous + SETEX stock trong 1 operation
- [ ] AC2: Gift debit wallet TRƯỚC insert gift row — không credit host trước khi deduct sender
- [ ] AC3: Buyer name mask mandatory: "Nguyen Van A" → "N**\***n" trong broadcast
- [ ] AC4: Costream invite = signed JWT, không random string, TTL=5min
- [ ] AC5: Rate limit gift: 1 gift/user/2s — Redis `gift:rl:{userId}` EXPIRE 2s

## Domain Rules

- `live:pin:stock:{streamId}` Redis atomic DECR cho purchase
- Gift flow: debit sender → INSERT gift → credit host → broadcast (nếu debit fail → 400 stop)
- Host-only actions: verify `userId === stream.hostId` server-side trước mọi action
- Costream revenue split on `LIVE_STREAM_ENDED` event, không split realtime

## Tasks

### Entities + Migration

1. `LivePinnedProduct` entity: `{ streamId, productId, variantId, pinnedAt, flashStock, flashPrice BIGINT }`
2. `LiveGift` entity: `{ streamId, senderId, hostId, giftType, coinCost, sentAt }`
3. `LiveCostreamSession` entity: `{ hostStreamId, guestStreamId, inviteToken, status, revenueShare }`
4. Migration `N_live_commerce.sql` — check SCHEMA.md cho migration number

### Core Services

5. `LivePinService.pinProduct()`: unpin previous (broadcast `live:unpin`) → `SETEX live:pin:stock:{streamId}` TTL=flash_duration → broadcast `live:product:pinned`
6. `PinTickService` (OnModuleInit): `setInterval 1s` per pinned item → broadcast `live:pin:tick:{streamId}`; stop khi TTL=0 hoặc stock=0
7. `LiveGiftService`: debit sender wallet (HTTP → wallet:3017) → INSERT gift → credit host wallet → broadcast `live:gift:received`
8. `LivePurchaseService`: DECR `live:pin:stock:{streamId}` → call order-service → broadcast `live:purchase:notify` (masked buyer) → emit `LIVE_PURCHASE_COMPLETED`
9. `CostreamService`: generate signed JWT invite (5min TTL) → `acceptInvite` merges Socket.IO rooms → `splitRevenueOnEnd` on `LIVE_STREAM_ENDED`

### Socket.IO Handlers (add to live.gateway.ts)

10. `live:pin:product` (host only) | `live:unpin` (host only) | `live:send:gift` | `live:buy:pinned` | `live:costream:invite` | `live:costream:accept`

### API

11. 7 REST endpoints: `POST /live/:id/pin` | `DELETE /live/:id/pin` | `GET /live/:id/gifts/leaderboard` | `GET /live/:id/host/revenue` | `POST /live/:id/costream/invite` | `POST /live/costream/accept` | `GET /live/:id/pinned-product`

### Events

12. `LIVE_PURCHASE_COMPLETED` — update EVENTS.md + add interface to `events.ts`
13. Rate limit middleware: `gift:rl:{userId}` INCR EXPIRE 2s → 429 nếu > 1

### Frontend

14. Extend `apps/web/src/app/live/[id]/page.tsx`: `PinnedProductCard`, `GiftPanel`, `GiftLeaderboard`, `SocialProofToast` (buyer name masked), costream accept UI

## Kafka Events

```
live.events:
  LIVE_PURCHASE_COMPLETED: { streamId, orderId, buyerId, productId, amount, maskedBuyerName }
```

## Edge Cases

- Wallet debit fail (insufficient balance) → 400 "Không đủ xu", không insert gift
- Host stream ended in middle of pin → broadcast unpin + restore unsold stock to main inventory
- Guest declines costream invite → JWT invalidated immediately
- Concurrent purchase same pinned slot → Redis DECR returns ≤ 0 → 409 "Hết hàng"

## Skip

- Gift animation FE (frontend team handles separately)
- Host revenue withdrawal (wallet-service spec)
- Costream analytics

## Fragments

+base +kafka +redis +tx +migration +verify-L4
