---
feature: Subscription Renewal BullMQ Cron Job
domain: '@social'
level: L2
status: READY
created: 2026-06-05
related-fe: apps/web/src/app/seller/subscription/page.tsx (đã có)
---

# Subscription Renewal BullMQ Cron Job

## Goal

Thêm BullMQ cron job chạy hàng ngày để tự động gia hạn / downgrade subscription, thông báo seller sắp hết hạn.

## Read First

- `apps/subscription-service/src/subscription.service.ts` ← 142 lines
- `apps/subscription-service/src/entities/seller-subscription.entity.ts`
- `apps/subscription-service/src/entities/subscription-plan.entity.ts`
- `libs/queue/src/constants/queue.constants.ts` ← queue names

## Acceptance Criteria

- [ ] AC1: Cron chạy lúc 02:00 VN timezone hàng ngày
- [ ] AC2: Subscription hết hạn → tier downgrade về FREE → session invalidation
- [ ] AC3: 3 ngày trước hết hạn → notification emit
- [ ] AC4: Auto-renew nếu seller đã set payment method (charge wallet)
- [ ] AC5: Commission rate cập nhật theo tier mới

## Domain Rules

- Tiers: FREE | BASIC | PRO | ENTERPRISE
- Commission rates: FREE=3% | BASIC=2.5% | PRO=2% | ENTERPRISE=1.5%
- On expire → revert FREE → invalidate `session:{userId}` Redis
- Notify: 3 days before expiry → `notification.events` topic priority=HIGH
- Add `SUBSCRIPTION_RENEWAL` to queue constants nếu chưa có

## Tasks

1. Add `SUBSCRIPTION_RENEWAL` job constant to `libs/queue/src/constants/queue.constants.ts`
2. `SubscriptionRenewalProcessor` — BullMQ processor, chạy daily cron `0 19 * * *` (UTC=02:00 VN)
3. `SubscriptionService.processExpirations()`:
   - Find subscriptions expiring today → downgrade to FREE
   - Invalidate Redis `session:{userId}` (force re-login for JWT refresh)
4. `SubscriptionService.sendRenewalReminders()`:
   - Find subscriptions expiring in 3 days → emit `notification.events`
5. Register processor in `SubscriptionModule`

## Kafka Events

```
Emit to notification.events:
  type: NOTIFICATION_REQUESTED
  data: { templateKey: 'subscription.expiry_warning', daysLeft: 3 }
  priority: HIGH
```

## Edge Cases

- Wallet insufficient for auto-renew → skip renew, send warning notification instead
- Multiple renewals same day (clock drift) → idempotency via `sub:renewed:{subscriptionId}:{date}` Redis SET NX TTL=86400

## Skip

- Payment charge logic for auto-renew (wallet.debit needs separate verify)
- Admin manual renewal override — separate spec
- FE subscription page — see Related FE

## Related Specs / FE

- FE: `apps/web/src/app/seller/subscription/page.tsx` — show expiry date, renew button (đã có page, cần real API)

## Fragments

+base +kafka +verify-L2
