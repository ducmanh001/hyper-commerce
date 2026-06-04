-- Migration 5: Wallet Service
-- Tables: wallet_transactions, wallet_outbox_events

-- ─── wallet_transactions ────────────────────────────────────────────────────
-- Append-only ledger. Balance = balance_after of the most-recent row per user.
-- All amounts in VND dong (BIGINT). NEVER float.

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL,
  type          VARCHAR(20)   NOT NULL CHECK (type IN (
                                'TOPUP','WITHDRAW','GIFT_SEND','GIFT_RECEIVE',
                                'CASHBACK','PAYOUT'
                              )),
  amount        BIGINT        NOT NULL,          -- positive = credit, negative = debit (VND)
  balance_after BIGINT        NOT NULL,          -- wallet balance snapshot after this row
  ref_id        UUID,                             -- orderId | giftEventId | payoutId
  metadata      JSONB,                            -- cashback_rate, gift_type, etc.
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Covering index: balance lookup → SELECT balance_after WHERE user_id ORDER BY created_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_time
  ON wallet_transactions (user_id, created_at DESC);

-- Idempotency: prevent double-processing same ref_id + type
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_ref_type
  ON wallet_transactions (ref_id, type)
  WHERE ref_id IS NOT NULL;

-- ─── wallet_outbox_events ────────────────────────────────────────────────────
-- Outbox pattern: events written in same DB transaction as wallet_transactions.
-- A background processor polls PENDING rows and publishes to Kafka.

CREATE TABLE IF NOT EXISTS wallet_outbox_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(50) NOT NULL,   -- 'WalletTransaction'
  aggregate_id   UUID        NOT NULL,   -- wallet_transactions.id
  topic          VARCHAR(100) NOT NULL,  -- 'wallet.events'
  partition_key  VARCHAR(100),           -- userId for ordered delivery
  payload        JSONB       NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PROCESSED','FAILED')),
  attempt_count  SMALLINT    NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_outbox_pending
  ON wallet_outbox_events (status, created_at)
  WHERE status = 'PENDING';
