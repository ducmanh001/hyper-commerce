-- ============================================================
-- Migration 004: Review Service Tables
-- Creates reviews + review_helpfuls tables with all indexes
-- ============================================================

-- ── reviews ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  order_id         UUID NOT NULL,
  product_id       UUID NOT NULL,
  seller_id        UUID NOT NULL,
  rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title            VARCHAR(100),
  content          TEXT,
  images           JSONB NOT NULL DEFAULT '[]',
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','flagged')),
  helpful_count    INT NOT NULL DEFAULT 0,
  moderation_score FLOAT,
  rejection_reason TEXT,
  seller_reply     TEXT,
  seller_replied_at TIMESTAMP WITH TIME ZONE,
  verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- One review per purchase per product
  CONSTRAINT uq_review_user_order_product UNIQUE (user_id, order_id, product_id)
);

-- Main listing index (product page → list approved reviews, newest first)
CREATE INDEX IF NOT EXISTS idx_reviews_product_status_date
  ON reviews (product_id, status, created_at DESC);

-- Seller dashboard index
CREATE INDEX IF NOT EXISTS idx_reviews_seller_status
  ON reviews (seller_id, status);

-- Moderation queue index (admin reads PENDING/FLAGGED oldest-first)
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON reviews (status, created_at ASC)
  WHERE status IN ('pending', 'flagged');

-- User's own reviews
CREATE INDEX IF NOT EXISTS idx_reviews_user_id
  ON reviews (user_id);

-- ── review_helpfuls ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_helpfuls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_helpful_review_user UNIQUE (review_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_review_helpfuls_review_id
  ON review_helpfuls (review_id);

-- ── Helper: updated_at trigger ────────────────────────────────
-- Reuse the existing trigger function if available, otherwise create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END;
$$;

CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Kafka topics (documentation, created by Kafka auto-create) ──
-- review.published     → search-service, notification-service, analytics
-- review.rejected      → notification-service (inform buyer)
-- review.seller_notification → notification-service (inform seller of new review)
-- review.rating_updated → search-service (update product ES doc)
