---
feature: Referral System
domain: '@architect'
level: L4
status: READY
created: 2026-06-05
---

# Referral System — Mời bạn bè, cả hai nhận thưởng

## Goal

Cho phép user tạo referral code, chia sẻ với bạn bè; khi bạn bè đặt đơn đầu tiên thành công cả hai nhận cashback VND vào wallet.

## Read First

- `infrastructure/postgres/SCHEMA.md` # migration number = 6
- `libs/events/EVENTS.md` # order.events + wallet.events
- `libs/events/src/events.ts` # UserRegisteredEvent, OrderDeliveredEvent
- `apps/user-service/src/entities/user-profile.entity.ts`
- `apps/wallet-service/src/entities/wallet-transaction.entity.ts`
- `apps/wallet-service/src/consumers/order-delivered.consumer.ts`

## Acceptance Criteria

- [ ] AC1: User đăng ký có thể lấy referral code duy nhất 8 ký tự
- [ ] AC2: User đăng ký với code của người khác → referral row PENDING được tạo
- [ ] AC3: Khi referee đặt đơn đầu tiên được giao → referrer nhận 30.000 VND, referee nhận 20.000 VND
- [ ] AC4: Mỗi referrer tối đa 50 lần được thưởng
- [ ] AC5: Reward chỉ credit 1 lần duy nhất (idempotency)
- [ ] AC6: `wallet_transactions` có row type=REFERRAL_REWARD cho cả hai

## Domain Rules

- Reward amounts: BIGINT VND — referrer=30000, referee=20000
- Max referrals per referrer: 50 (check trước khi credit)
- Idempotency: Redis key `referral:rewarded:{referralId}` TTL=permanent (SET NX)
- isFirstOrder detection: order-service thêm field vào ORDER_DELIVERED event (tránh cross-DB)
- Soft delete: referrals table dùng deletedAt

## Tasks

### user-service

1. Add `referralCode VARCHAR(8) UNIQUE NULLABLE` to `user_profiles` entity
2. Generate `nanoid(8)` code on user register → store in user_profiles
3. On register with `?ref={code}`: lookup referral:code:{code} Redis → create referrals row (status=PENDING)
4. Store referral code in Redis: `referral:code:{code}` → `{referrerId}` TTL=365d
5. Add optional `referralCode?: string` to `UserRegisteredEvent` interface

### order-service

6. Add `isFirstOrder: boolean` to `OrderDeliveredEvent` interface in events.ts
7. In ORDER_DELIVERED emit: check `orders WHERE userId COUNT = 1` → set isFirstOrder
8. Cache result: `order:first:{userId}` SET 1 EX 86400 (prevent repeat DB query)

### wallet-service

9. Add `REFERRAL_REWARD` to `TransactionType` enum in wallet-transaction.entity.ts
10. Extend `OrderDeliveredConsumer`: if `isFirstOrder === true` → lookup referrals WHERE refereeId=userId AND status=PENDING
11. Check referrer reward count ≤ 50 (count REFERRAL_REWARD txs for referrerId)
12. Idempotency check: `referral:rewarded:{referralId}` Redis SET NX
13. Credit referrer 30.000 VND + referee 20.000 VND in single QueryRunner transaction
14. Update referrals.status = REWARDED, referrals.orderId = orderId
15. Emit `ReferralRewardedEvent` to `referral.events` topic

## Kafka Events

```typescript
// ADD to libs/events/src/events.ts
interface OrderDeliveredEvent extends DomainEvent {
  eventType: 'ORDER_DELIVERED';
  orderId: string;
  userId: string;
  sellerId: string;
  totalAmount: number;
  isFirstOrder: boolean; // NEW field
}

interface ReferralRewardedEvent extends DomainEvent {
  eventType: 'REFERRAL_REWARDED';
  referralId: string;
  referrerId: string;
  refereeId: string;
  referrerReward: number; // 30000
  refereeReward: number; // 20000
  orderId: string;
}
```

```
// ADD to libs/events/EVENTS.md routing table
referral.events | wallet-service | analytics-service, notification-service
```

## Migration

```sql
-- Number: 6
-- File: infrastructure/postgres/migrations/6_referral_system.sql

ALTER TABLE user_profiles ADD COLUMN referral_code VARCHAR(8) UNIQUE;
CREATE INDEX idx_user_profiles_referral_code ON user_profiles(referral_code);

CREATE TABLE referrals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id    UUID NOT NULL REFERENCES users(id),
  referee_id     UUID NOT NULL REFERENCES users(id),
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  referrer_reward BIGINT NOT NULL DEFAULT 30000,
  referee_reward  BIGINT NOT NULL DEFAULT 20000,
  order_id       UUID,
  rewarded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_referee  ON referrals(referee_id);
CREATE INDEX idx_referrals_status   ON referrals(status);

-- ROLLBACK:
-- DROP TABLE referrals;
-- ALTER TABLE user_profiles DROP COLUMN referral_code;
```

## Edge Cases

- Referee tự nhập code của mình → validate referrerId ≠ refereeId
- Referee đặt nhiều đơn cùng lúc → Redis idempotency NX chặn duplicate
- Referrer đã đủ 50 → log warning, không credit, không fail
- Code không tồn tại khi đăng ký → ignore silently, user vẫn đăng ký được

## Skip

- Frontend referral page (separate spec)
- Admin dashboard referral stats
- Referral code expiry (TTL=permanent for now)
- SMS/email notification on reward (add later via referral.events)
- Referral tier bonuses

## Fragments

+base +kafka +tx +migration +verify-L4
