---
feature: Wishlist Service — Backend + FE Integration
domain: '@commerce'
level: L3
status: READY
created: 2026-06-05
related-fe: apps/web/src/app/wishlist/page.tsx (đã có) + apps/web/src/lib/store/wishlist.ts (Zustand store đã có)
---

# Wishlist Service — Backend API + FE Integration

## Goal

`wishlist/page.tsx` và Zustand store đã có ở FE nhưng không có backend service nào. Tạo wishlist API trong user-service và wire với FE real API thay mock.

## Read First

- `infrastructure/postgres/SCHEMA.md` ← migration 7
- `apps/web/src/lib/store/wishlist.ts` ← Zustand store để biết shape FE expect
- `apps/web/src/app/wishlist/page.tsx` ← FE page hiện tại
- `apps/user-service/src/user.module.ts`
- `apps/api-gateway/server.js` ← cần thêm proxy route

## Acceptance Criteria

- [ ] AC1: `POST /wishlist/:productId` — thêm sản phẩm, trả 409 nếu đã có
- [ ] AC2: `DELETE /wishlist/:productId` — xóa, 404 nếu không có
- [ ] AC3: `GET /wishlist` — trả list với giá hiện tại, đánh dấu out-of-stock
- [ ] AC4: Max 100 items per user (return 400 nếu exceed)
- [ ] AC5: FE wishlist page dùng real API thay vì mock/local state

## Domain Rules

- `wishlist_items` table owned by user-service (sharded by user_id)
- Giá snapshot (`savedPrice BIGINT`) lưu lúc add — không update tự động
- Out-of-stock flag: query inventory-service hoặc cache `inv:stock:{productId}:{variantId}`
- Cache wishlist: `wishlist:{userId}` TTL=300s (invalidate on add/remove)

## Tasks

### user-service (backend)

1. Entity: `wishlist_items` — `userId, productId, variantId?, savedPrice BIGINT, addedAt`
2. Migration 7: `CREATE TABLE wishlist_items (...)` + indexes
3. `WishlistService.add(userId, productId, variantId?)` — check max 100, idempotency
4. `WishlistService.remove(userId, productId)` — soft delete via deletedAt
5. `WishlistService.list(userId)` — với Redis cache `wishlist:{userId}` TTL=300s
6. `WishlistController` — 3 endpoints auth-protected
7. Add proxy route `/wishlist` → user-service in `api-gateway/server.js`

### web (frontend)

8. Update `apps/web/src/lib/store/wishlist.ts` — replace mock với real API calls
9. Update `apps/web/src/app/wishlist/page.tsx` — loading state, error state, optimistic remove

## Migration

```sql
-- Number: 7
-- File: infrastructure/postgres/migrations/7_wishlist.sql
CREATE TABLE wishlist_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  product_id   UUID NOT NULL,
  variant_id   UUID,
  saved_price  BIGINT NOT NULL DEFAULT 0,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (user_id, product_id, variant_id)
);
CREATE INDEX idx_wishlist_user ON wishlist_items(user_id) WHERE deleted_at IS NULL;
-- ROLLBACK: DROP TABLE wishlist_items;
```

## Edge Cases

- User adds same product twice → return existing item (idempotent, no duplicate)
- Product deleted from catalog → keep in wishlist but mark unavailable
- variantId null vs specific variant → treat as separate wishlist items

## Skip

- Price drop notification (depends on referral/wallet, separate spec)
- Share wishlist publicly
- Admin wishlist analytics

## Fragments

+base +redis +migration +verify-L3
