---
description: Implement Wallet & Loyalty Ledger Service (port 3017)
mode: agent
---

# Wallet & Loyalty Ledger Service

> Spec: `infrastructure/postgres/SCHEMA.md` § wallet-service (migration 005)  
> Events: `libs/events/EVENTS.md` topics `wallet.events`  
> Pattern: follow `apps/order-service/src/` structure + `apps/user-service/src/` for entity conventions

## Checklist

- [ ] Read SCHEMA.md § wallet-service → write migration `005_wallet_loyalty.sql` → update SCHEMA.md
- [ ] Scaffold service: `npx nest generate app wallet-service` → port 3017 → register in `nest-cli.json`
- [ ] 4 entities: `Wallet`, `WalletTransaction`, `Referral`, `LoyaltyTier` (bigint for all VND amounts)
- [ ] `LedgerService` — `credit()` + `debit()` inside `dataSource.transaction()` with `SELECT ... FOR UPDATE`; idempotency_key check first
- [ ] `WalletService` — `getOrCreateWallet`, `getBalanceSummary`, `initiateTopup`, `spendWallet` (debit order: CASHBACK → COIN → CASH)
- [ ] `ReferralService` — `generateReferralCode` (base58, Redis TTL=365d), `applyReferralCode` (max depth 3), `activateReferralOnFirstOrder`
- [ ] `LoyaltyService` — `creditCashbackForOrder` (floor VND, 30d expiry), `getTierProgress`, tier recompute on spend
- [ ] Kafka consumer `order.events`: ORDER_CONFIRMED → cashback + referral activation; REFUND_PROCESSED → debit cashback
- [ ] `WebhookGuard`: HMAC-SHA256 verify (ZaloPay: `ZALOPAY_SECRET_KEY`, MoMo: `MOMO_SECRET_KEY`) → 403 on mismatch
- [ ] 8 REST endpoints (see SCHEMA.md) → JWT guard on all except webhook
- [ ] Add queue constants to `libs/queue/src/constants/queue.constants.ts`
- [ ] Emit `WALLET_CREDITED`/`WALLET_DEBITED` to `wallet.events` (see EVENTS.md for payload)
- [ ] Gateway proxy: `apps/api-gateway/server.js` → `/api/v1/wallet` → `http://localhost:3017`
- [ ] Frontend: extend `apps/web/src/app/points/page.tsx` → WalletBalanceCard, TierProgressBar, ReferralCard, TopupModal

## Security (non-negotiable)

- `SELECT ... FOR UPDATE` on all balance writes — prevents oversell/overdraft under concurrency
- Webhook: verify HMAC before ANY DB write
- Self-referral: validate `referrerUserId !== newUserId`
- All monetary amounts: `Math.floor()` — never floats
