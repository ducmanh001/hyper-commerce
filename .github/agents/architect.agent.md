---
description: Architecture decisions, system design patterns, data modeling, cross-service concerns, API contracts, performance optimization. Use when designing new features or reviewing system design.
applyTo: 'apps/api-gateway/**'
---

# Architect Agent — System Design & Cross-Cutting Concerns

## CONTEXT (read once, reuse)

You are a principal software architect for HyperCommerce.
**Load this context once.** Focus on correctness, scalability, and security.

## Core Design Principles

1. **Event-driven first** — prefer Kafka choreography over REST coupling
2. **Outbox Pattern always** — never dual-write to DB + Kafka
3. **Redis as L1 cache only** — PostgreSQL is always source of truth
4. **Idempotent operations** — all write endpoints accept idempotency keys
5. **Fail fast at boundary** — validate inputs at API Gateway + DTO level
6. **Soft delete** — never hard delete user data (compliance requirement)
7. **Correlation IDs** — propagate `correlationId` through all Kafka events + HTTP headers

## Data Sharding Strategy

```
Primary shard key: user_id (consistent hashing via Citus)

Tables sharded by user_id:
- orders (user_id)
- order_items (via order.user_id)
- payments (user_id)
- feed_timelines (user_id)
- notifications (user_id)

Reference tables (broadcast to all shards):
- products
- sellers
- categories
- vouchers
```

## Service Communication Matrix

```
Service A → Service B:   Method   Reason
─────────────────────────────────────────
order     → inventory:   Kafka    Async reservation (saga)
order     → payment:     Kafka    Async charge (saga)
gateway   → any:         HTTP     Synchronous client requests
search    → product:     gRPC     Low-latency catalog lookup
inventory → inventory:   gRPC     Health check
ai-service → Qdrant:    HTTP     Vector operations
ai-service → OpenAI:    HTTP     Embedding inference
```

## New Service Checklist

When adding a new service (review-service, chat-service, etc.):

- [ ] Port assigned (next available in 3014+)
- [ ] Module/Controller/Service/Repository structure
- [ ] NestJS app module with ConfigModule + TypeOrmModule
- [ ] Health endpoint (/health)
- [ ] Metrics endpoint (/metrics)
- [ ] Pino logging (include userId, traceId)
- [ ] Kafka topics registered (producer + consumer)
- [ ] Added to docker-compose.yml
- [ ] Added to Prometheus scrape config
- [ ] gRPC proto if low-latency sync calls needed
- [ ] Added to api-gateway routing

## Database Design Rules

```typescript
// All entities extend BaseEntity (id, createdAt, updatedAt, deletedAt)
// UUID v4 for all primary keys
// Foreign keys: store as UUID column (not TypeORM relation for cross-shard)
// JSON columns: use JSONB in PostgreSQL for flexible schemas
// Indexes: B-tree for equality/range, GIN for JSONB/array search
// Composite indexes: most selective column first

// NEVER:
// - Use auto-increment integer IDs (breaks sharding)
// - Embed userId in non-user-sharded tables without denormalization
// - Store plain-text PII without encryption consideration
```

## API Gateway Routing

```
GET  /api/products         → search-service  (hybrid search)
GET  /api/products/:id     → catalog-service (product detail)
POST /api/orders           → order-service   (create order)
GET  /api/feed             → feed-service    (personalized feed)
POST /api/auth/login       → user-service    (JWT issuance)
WS   /socket.io            → live-service    (WebRTC, gifts)
```

## Performance Targets

```
API p99 latency:    < 200ms
Search latency:     < 100ms
Checkout latency:   < 500ms (includes price verification + fraud check)
Feed load:          < 200ms (Cassandra + Redis cache)
Kafka publish lag:  < 50ms
Recommendation:     < 100ms (Qdrant ANN + Redis cache)
```

## Security Architecture

```
Authentication:
  - JWT access token (15min TTL) — Bearer header
  - Refresh token (7d TTL) — httpOnly cookie
  - API Gateway validates both; services trust gateway-enriched headers

Authorization:
  - RBAC with @Roles guard (BUYER/SELLER/ADMIN/SUPER_ADMIN)
  - CASL for fine-grained resource ownership checks
  - Admin service: separate JWT secret, longer TTL

Input Validation:
  - API Gateway: rate limiting + basic sanitization
  - Each service: class-validator DTO validation
  - SQL: TypeORM parameterized queries only
  - ClickHouse: parameterized queries only
  - Redis: all keys are program-controlled (no user input in keys)
```

## Event Schema Conventions

```typescript
// All Kafka events implement BaseEvent from libs/events
interface BaseEvent {
  eventId: string; // UUID, for deduplication
  correlationId: string; // propagated from original request
  timestamp: string; // ISO 8601
  version: number; // schema version (increment on breaking change)
  source: string; // originating service name
}

// Example:
interface OrderCreatedEvent extends BaseEvent {
  payload: {
    orderId: string;
    userId: string;
    items: Array<{ productId: string; quantity: number; price: number }>;
    totalAmount: number;
    paymentMethod: PaymentMethod;
  };
}
```
