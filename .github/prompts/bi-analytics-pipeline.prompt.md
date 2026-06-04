---
description: Implement BI Analytics Pipeline (ClickHouse + Seller Dashboard + Admin BI)
mode: agent
---

# BI Analytics Pipeline

> Events consumed: ALL topics in `libs/events/EVENTS.md`  
> Pattern: extend `apps/analytics-service/src/` (clickhouse/ + event-collector already exist)  
> Admin routes: `apps/admin-service/src/` at `:3011` (localhost-only)

## Checklist

- [ ] Create `infrastructure/clickhouse/migrations/001_analytics_schema.sql`: tables `orders_fact`, `user_events_fact`, `live_stream_fact`, `fraud_signals_fact` + materialized views `seller_daily_summary`, `platform_hourly_summary`
- [ ] `ClickHouseMigrationsService` (OnModuleInit): run SQL files on startup via ClickHouse HTTP API
- [ ] `UniversalEventsConsumer`: subscribe all Kafka topics → map each event type → INSERT to correct ClickHouse fact table (use `libs/events/EVENTS.md` for payload shapes)
- [ ] `AnalyticsQueryService`: `getSellerGMV(sellerId, period, granularity)`, `getFunnelConversion()`, `getFraudRate(windowMinutes)`, `getPlatformGMV()`, `getTopSellers()`
- [ ] All ClickHouse queries: validate UUID params with `isUUID()` before interpolation — no raw user input in query strings
- [ ] `AlertCheckerService`: sliding window counters in Redis → emit `analytics.alerts` Kafka event when thresholds exceeded; dedup TTL=15min per alertType
- [ ] 9 REST endpoints: 5 seller (auth: seller role) + 4 platform (auth: admin role, via admin-service :3011)
- [ ] Rate limit analytics endpoints: 10 req/min/user (ClickHouse is OLAP not OLTP)
- [ ] Frontend seller: `apps/web/src/app/seller/analytics/page.tsx` → GmvChart, FunnelChart, TopProductsTable, LivePerformanceCard (staleTime=60s)
- [ ] Frontend admin: `apps/web/src/app/admin/analytics/page.tsx` → PlatformGmvCard, FraudAlertBanner, TopSellersTable

## Security (non-negotiable)

- `platform/*` endpoints: `@Roles('admin')` — seller MUST NOT see platform-wide data
- ClickHouse credentials: `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` env vars only
- Alert dedup (Redis TTL=900s) — prevents storm from flooding ops.agent
- Admin analytics calls go through `:3011` bound to `127.0.0.1` — not public gateway
