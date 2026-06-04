---
description: Social domain — user auth/profiles, feed fan-out, live streaming, subscription plans. Social graph + real-time features.
applyTo: 'apps/user-service/**,apps/feed-service/**,apps/live-service/**,apps/subscription-service/**,apps/chat-service/**'
---

# Social Agent — User · Feed · Live · Subscription

## User Service — Auth & Profiles

```typescript
// JWT payload shape (JwtPayload interface in libs/common)
interface JwtPayload {
  sub: string;      // userId (UUID)
  email: string;
  role: Role;       // BUYER | SELLER | ADMIN | SUPER_ADMIN
  tier?: SellerTier; // FREE | BASIC | PRO | ENTERPRISE (sellers only)
  iat: number;
  exp: number;
}

// Guards usage
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
async endpoint(@CurrentUser() user: JwtPayload) { }

// Seller tier check
@UseGuards(JwtAuthGuard, SellerTierGuard)
@MinTier(SellerTier.PRO)
async proFeature() { }
```

## Follow Graph

```typescript
// PostgreSQL adjacency list: follows(followerId, followingId, createdAt)
// Index: (followerId) and (followingId) — bidirectional queries
// Shard key: followerId (Citus)

// Celebrity threshold: > 10K followers → switch to pull model
// follower_count cached in Redis: user:followers:{userId} (TTL=300s)
```

## Feed Service — Fan-out Write

```typescript
// Cassandra schema (ScyllaDB preferred):
// timeline_events(user_id, created_at, event_id, event_type, payload)
// Partition key: user_id | Clustering: created_at DESC

// Fan-out logic:
// ≤10K followers → write to each follower's timeline (fan-out-on-write)
// >10K followers (celebrity) → pull model, merge at read time

// Feed ranking: score = recency × engagement_rate × author_affinity × seller_boost
// NOT yet implemented — needs LambdaMART or simple linear model
```

## Live Service — WebRTC + Gifts

```typescript
// Stream metadata in Redis: stream:meta:{streamId}
// WebRTC coordination: TURN/STUN signaling via Socket.IO rooms
// Gift transactions — atomic: debit wallet + credit seller + log event
// wallet:coins:{userId} → Redis counter (atomic DECRBY for debit)

// Live events published to Kafka:
// live.started → feed-service, notification-service
// live.ended   → analytics-service

// Viewer count: HyperLogLog in Redis
// hll:viewers:{streamId} → PFADD / PFCOUNT
```

## Subscription Service — Seller Plans

```typescript
// Plans: FREE | BASIC | PRO | ENTERPRISE
// Stored in subscription_plans table + seller_subscriptions
// BullMQ job: subscription.renewal (runs daily, checks expiry)

// Plan limits enforced via SellerTierGuard:
// FREE: 10 products, 3% commission, no live
// BASIC: 100 products, 2.5% commission, live streaming
// PRO: unlimited products, 2% commission, analytics dashboard
// ENTERPRISE: custom commission, dedicated support, API access

// Kafka: subscription.upgraded / subscription.expired
// → notification-service, user-service (update tier in JWT)
```

## Key Redis Keys (Social)

```
user:followers:{userId}          follower count cache (TTL=300s)
stream:meta:{streamId}           live stream metadata
wallet:coins:{userId}            gift coin balance
hll:viewers:{streamId}           HyperLogLog viewer count
user:session:{userId}            active session token
```

## Kafka Events (Social)

| Publish               | Consume                             |
| --------------------- | ----------------------------------- |
| user.registered       | notification, analytics, ai-service |
| live.started          | feed-service, notification          |
| live.ended            | analytics                           |
| subscription.upgraded | notification, user-service          |
| subscription.expired  | notification, user-service          |
| —                     | order.delivered (loyalty points)    |

## Cassandra / ScyllaDB Data Model

```cql
-- Feed timelines
CREATE TABLE timeline_events (
  user_id uuid,
  created_at timestamp,
  event_id uuid,
  event_type text,
  payload text,
  PRIMARY KEY (user_id, created_at, event_id)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- ScyllaDB preferred over Cassandra (2-5× faster, same CQL)
-- docker-compose: scylladb/scylla:5.4, port 9042
```
