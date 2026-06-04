---
description: Platform domain — notifications (FCM/SMS/Email), analytics (ClickHouse), admin BI, ads GSP auction. Background jobs + OLAP.
applyTo: 'apps/notification-service/**,apps/analytics-service/**,apps/admin-service/**,apps/ads-service/**'
---

# Platform Agent — Notification · Analytics · Admin · Ads

## Notification Service — Priority Queues

```typescript
// BullMQ queue: 'notifications' with 3 priority levels
// Priority 1 (CRITICAL): payment failures, fraud alerts
// Priority 2 (HIGH): order status updates, OTP
// Priority 3 (NORMAL): marketing, feed digests

// Channels: FCM (mobile push) | Twilio (SMS) | SendGrid (email)
// Channel selection: user.notification_preferences JSON column

// Job retry: 3 attempts, exponential backoff (1s → 2s → 4s)
// Dead letter queue: failed jobs → manual review queue

// Template rendering: Handlebars with i18n (vi/en)
// Never hardcode message strings — use template keys
```

## Analytics Service — ClickHouse OLAP

```typescript
// ClickHouse tables (column-store, immutable inserts):
// events: (event_id, user_id, session_id, event_type, properties, created_at)
// orders_analytics: (order_id, gmv, commission, seller_id, created_at)
// live_metrics: (stream_id, peak_viewers, gifts_revenue, duration, created_at)

// Event ingestion: REST POST /events (batch up to 1000 events/req)
// NEVER UPDATE or DELETE in ClickHouse — append only
// Materialized views for aggregations (refresh on INSERT)

// Query pattern: always include date range filter (uses partition pruning)
// SELECT ... FROM events WHERE toDate(created_at) BETWEEN today()-7 AND today()

// Kafka consumer: analytics-service consumes ALL domain events
// order.*, user.*, live.*, payment.* → insert to ClickHouse
```

## Admin Service — BI & Ops (localhost only)

```typescript
// CRITICAL: admin-service MUST bind to 127.0.0.1 ONLY in prod
// NEVER expose to 0.0.0.0 — internal BI dashboard only

// Features: GMV dashboard, dispute management, seller verification,
//           fraud review queue, subscription management, manual refunds

// Auth: Admin JWT with ADMIN/SUPER_ADMIN role + IP whitelist middleware
// All admin actions logged to audit_logs table (userId, action, target, before, after)
```

## Ads Service — GSP Auction

```typescript
// GSP (Generalized Second Price) Auction algorithm:
// effective_bid = bid × √CTR    (quality-adjusted bid)
// winner pays: 2nd_highest_effective_bid + ₫1 (minimum increment)

// Budget tracking in Redis (Lua atomic DECRBY):
// hc:ads:budget:{campaignId}        lifetime budget remaining
// hc:ads:daily:{campaignId}:{date}  daily budget remaining
// Both keys checked atomically before serving ad — NEVER serve if either is 0

// Campaign states: DRAFT → ACTIVE → PAUSED → COMPLETED
// Budget exhausted → auto-pause campaign + notify seller

// Impression logging: async, batched to ClickHouse via BullMQ
// CTR calculation: rolling 7-day window materialized view

// Kafka: ads.impression_logged / ads.campaign_paused
```

## Key Redis Keys (Platform)

```
hc:ads:budget:{campaignId}         lifetime budget (atomic DECRBY)
hc:ads:daily:{campaignId}:{date}   daily budget (atomic DECRBY)
notif:dedup:{userId}:{templateKey} notification dedup (TTL=3600s)
analytics:buffer:{date}            event buffer before ClickHouse flush
```

## Kafka Events (Platform — consumers)

```
order.confirmed  → notification (send confirmation email)
order.shipped    → notification (send tracking SMS)
order.delivered  → notification (send review prompt)
payment.captured → analytics (GMV event)
payment.failed   → notification (CRITICAL priority)
fraud.detected   → notification (CRITICAL), admin
user.registered  → analytics, notification (welcome email)
live.started     → notification (follower push batch)
dispute.opened   → notification, admin
```

## BullMQ Job Definitions

```typescript
// Queue names (from libs/queue):
// 'notifications'      priority 1-3
// 'analytics-flush'    batch ClickHouse inserts
// 'email-bulk'         marketing campaigns
// 'subscription-renewal' daily cron

// Job pattern
await this.queue.add(
  'send-notification',
  { userId, channel, templateKey, data },
  {
    priority: NotificationPriority.HIGH,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
);
```

## Admin Audit Logging (REQUIRED)

```typescript
// Every state-changing admin action MUST log:
await this.auditRepo.save({
  adminId: user.sub,
  action: 'MANUAL_REFUND',
  targetType: 'Order',
  targetId: orderId,
  before: JSON.stringify(before),
  after: JSON.stringify(after),
  ipAddress: req.ip,
});
```
