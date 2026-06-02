-- ============================================================
-- HYPERCOMMERCE — Performance Migration 003
-- High-impact database optimizations for production load.
--
-- STRATEGY:
-- 1. Partial indexes: skip NULL and low-selectivity values
-- 2. Covering indexes: avoid heap fetches on hot queries
-- 3. Composite indexes: match real query patterns (not just WHERE)
-- 4. BRIN indexes: time-series tables (low cost, good for range scans)
-- 5. Materialized views: expensive aggregations computed offline
--
-- EXECUTION:
-- Run with: psql -U hc_user -d hypercommerce -f 003_performance_indexes.sql
-- Estimated execution time: 15-30 min on production data
-- Use CREATE INDEX CONCURRENTLY to avoid locking tables.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- ORDERS TABLE
-- Hot queries: user order list, seller dashboard, status filters
-- ─────────────────────────────────────────────────────────────

-- User order list with cursor pagination (most common query)
-- Covers: SELECT id, status, total_amount, created_at WHERE userId=? ORDER BY created_at DESC LIMIT ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created_covering
  ON orders (user_id, created_at DESC)
  INCLUDE (status, total_amount, currency, seller_id)
  WHERE status != 'CANCELLED';  -- Partial: skip cancelled (30%+ of orders)

-- Seller dashboard: orders by seller, status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_seller_status_created
  ON orders (seller_id, status, created_at DESC)
  WHERE seller_id IS NOT NULL;

-- Active orders by status (for Saga consumers)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_partial
  ON orders (status, updated_at)
  WHERE status IN ('PENDING', 'STOCK_RESERVED', 'PAYMENT_PROCESSING');

-- DISPUTED orders for CS dashboard
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_disputed
  ON orders (status, updated_at)
  WHERE status = 'DISPUTED';

-- Idempotency key lookup (already unique, add covering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_idempotency_covering
  ON orders (idempotency_key)
  INCLUDE (id, status, user_id)
  WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- ORDER ITEMS TABLE
-- Hot queries: order detail, product sales analytics
-- ─────────────────────────────────────────────────────────────

-- Order items by product (for inventory sold-count updates)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_product_date
  ON order_items (product_id, created_at DESC)
  INCLUDE (quantity, unit_price, subtotal);

-- ─────────────────────────────────────────────────────────────
-- VOUCHERS TABLE
-- Hot queries: code lookup, active vouchers list
-- ─────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vouchers_active_window
  ON vouchers (code, status)
  WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vouchers_seller_active
  ON vouchers (seller_id, status, expires_at)
  WHERE status = 'ACTIVE' AND seller_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- COMMISSIONS TABLE
-- Hot queries: seller earnings, settlement batch
-- ─────────────────────────────────────────────────────────────

-- Seller commission summary (date range queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_seller_date
  ON commissions (seller_id, created_at DESC)
  INCLUDE (order_gmv, platform_commission, seller_net_amount, status);

-- Settlement batch: pending earned commissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_settlement
  ON commissions (settlement_period, status)
  WHERE status = 'EARNED';

-- ─────────────────────────────────────────────────────────────
-- DISPUTES TABLE
-- Hot queries: seller response queue, CS escalation queue
-- ─────────────────────────────────────────────────────────────

-- Seller's open disputes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_seller_open
  ON disputes (seller_id, status, created_at DESC)
  WHERE status IN ('OPEN', 'AWAITING_SELLER_RESPONSE', 'ESCALATED');

-- Escalation scheduler: overdue disputes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_overdue
  ON disputes (respond_by_deadline)
  WHERE status = 'AWAITING_SELLER_RESPONSE';

-- Buyer dispute list
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_buyer
  ON disputes (buyer_id, created_at DESC)
  INCLUDE (status, reason, order_id);

-- ─────────────────────────────────────────────────────────────
-- MATERIALIZED VIEWS — Pre-computed aggregations
-- Refresh: pg_cron job every 5 minutes (analytics latency acceptable)
-- ─────────────────────────────────────────────────────────────

-- Seller GMV Dashboard (refreshed every 5 min via pg_cron)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_seller_daily_gmv AS
SELECT
  seller_id,
  DATE_TRUNC('day', created_at)  AS date,
  COUNT(*)                        AS orders_count,
  SUM(total_amount)               AS gmv,
  AVG(total_amount)               AS avg_order_value,
  COUNT(*) FILTER (WHERE status IN ('CANCELLED', 'REFUNDED')) AS cancelled_count
FROM orders
WHERE created_at >= NOW() - INTERVAL '90 days'
  AND seller_id IS NOT NULL
GROUP BY seller_id, DATE_TRUNC('day', created_at)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_seller_daily_gmv
  ON mv_seller_daily_gmv (seller_id, date);

-- Platform GMV by day (for admin dashboard)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_platform_daily_gmv AS
SELECT
  DATE_TRUNC('day', created_at) AS date,
  COUNT(*)                       AS orders_count,
  SUM(total_amount)              AS total_gmv,
  COUNT(DISTINCT user_id)        AS unique_buyers,
  COUNT(DISTINCT seller_id)      AS active_sellers,
  AVG(total_amount)              AS avg_order_value,
  SUM(total_amount) FILTER (WHERE currency = 'VND')  AS gmv_vnd,
  SUM(total_amount) FILTER (WHERE currency = 'USD')  AS gmv_usd
FROM orders
WHERE created_at >= NOW() - INTERVAL '365 days'
  AND status NOT IN ('CANCELLED')
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_platform_daily_gmv
  ON mv_platform_daily_gmv (date);

-- Hourly order throughput (for SLO monitoring, refreshed every minute)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_order_throughput AS
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  status,
  COUNT(*)                        AS count,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) AS avg_processing_seconds
FROM orders
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at), status
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_throughput
  ON mv_hourly_order_throughput (hour, status);

-- Product sales leaderboard (for trending products)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_sales_30d AS
SELECT
  product_id,
  SUM(quantity)       AS units_sold,
  SUM(subtotal)       AS revenue,
  COUNT(DISTINCT oi.order_id) AS orders_count,
  AVG(unit_price)     AS avg_price
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.created_at >= NOW() - INTERVAL '30 days'
  AND o.status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED')
GROUP BY product_id
ORDER BY units_sold DESC
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_product_sales_30d
  ON mv_product_sales_30d (product_id);

-- ─────────────────────────────────────────────────────────────
-- pg_cron: Schedule materialized view refreshes
-- Requires pg_cron extension installed on PostgreSQL
-- ─────────────────────────────────────────────────────────────

-- Refresh GMV views every 5 minutes
SELECT cron.schedule(
  'refresh-seller-daily-gmv',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_seller_daily_gmv$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-seller-daily-gmv'
);

SELECT cron.schedule(
  'refresh-platform-daily-gmv',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_platform_daily_gmv$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-platform-daily-gmv'
);

SELECT cron.schedule(
  'refresh-hourly-throughput',
  '* * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_order_throughput$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-hourly-throughput'
);

SELECT cron.schedule(
  'refresh-product-sales',
  '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_sales_30d$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-product-sales'
);

-- ─────────────────────────────────────────────────────────────
-- QUERY OPTIMIZATION HINTS
-- Statistics for planner
-- ─────────────────────────────────────────────────────────────

-- Increase statistics for high-cardinality columns used in filters
ALTER TABLE orders ALTER COLUMN user_id SET STATISTICS 500;
ALTER TABLE orders ALTER COLUMN seller_id SET STATISTICS 500;
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 200;
ALTER TABLE order_items ALTER COLUMN product_id SET STATISTICS 500;

-- Analyze to apply new statistics
ANALYZE orders;
ANALYZE order_items;
ANALYZE vouchers;
ANALYZE commissions;
ANALYZE disputes;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- Run after migration to confirm indexes were created
-- ─────────────────────────────────────────────────────────────

-- Check all indexes created:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('orders', 'order_items', 'vouchers', 'commissions', 'disputes') ORDER BY tablename, indexname;

-- Check materialized views:
-- SELECT matviewname, ispopulated FROM pg_matviews;

-- Check pg_cron jobs:
-- SELECT jobname, schedule, command FROM cron.job;
