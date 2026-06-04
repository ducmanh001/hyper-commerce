---
feature: Product Backlog — All Pending Tasks
domain: 'all'
level: reference
status: LIVING DOCUMENT
created: 2026-06-05
---

# HyperCommerce — Product Backlog

> Living document. Update status khi task hoàn thành.
> Invoke spec: `@{agent} #file:.github/specs/{name}.spec.md +wrap`

---

## 🔴 Cực lớn — Blocking core UX

| #   | Task                               | Spec                                                               | Level | Agent        | Status |
| --- | ---------------------------------- | ------------------------------------------------------------------ | ----- | ------------ | ------ |
| 1   | Qdrant + Search Embedding Pipeline | [qdrant-search-embedding.spec.md](qdrant-search-embedding.spec.md) | L3    | `@ai-ml`     | TODO   |
| 2   | Feed Ranking v1 Linear Complete    | [feed-ranking-v1.spec.md](feed-ranking-v1.spec.md)                 | L3    | `@ai-ml`     | TODO   |
| 3   | Referral System (3 services)       | [referral-system.spec.md](referral-system.spec.md)                 | L4    | `@architect` | READY  |

**Invoke:**

```
@ai-ml #file:.github/specs/qdrant-search-embedding.spec.md +wrap
@ai-ml #file:.github/specs/feed-ranking-v1.spec.md +wrap
@architect #file:.github/specs/referral-system.spec.md +wrap
```

---

## 🟠 Lớn — Important for operations

| #   | Task                      | Spec                                                                   | Level | Agent     | Status |
| --- | ------------------------- | ---------------------------------------------------------------------- | ----- | --------- | ------ |
| 4   | Fraud Detection L1 Verify | [fraud-detection-l1.spec.md](fraud-detection-l1.spec.md)               | L2    | `@ai-ml`  | TODO   |
| 5   | Subscription Renewal Cron | [subscription-renewal-cron.spec.md](subscription-renewal-cron.spec.md) | L2    | `@social` | TODO   |
| 6   | ScyllaDB docker-compose   | [scylladb-docker-compose.spec.md](scylladb-docker-compose.spec.md)     | L3    | `@infra`  | TODO   |

**Invoke:**

```
@ai-ml #file:.github/specs/fraud-detection-l1.spec.md +wrap
@social #file:.github/specs/subscription-renewal-cron.spec.md +wrap
@infra #file:.github/specs/scylladb-docker-compose.spec.md +wrap
```

---

## 🟡 Vừa — Quick wins / Unblock other tasks

| #   | Task                    | Spec                                                   | Level | Agent       | Status |
| --- | ----------------------- | ------------------------------------------------------ | ----- | ----------- | ------ |
| 7   | gRPC Wire 4 Services    | [grpc-wire-modules.spec.md](grpc-wire-modules.spec.md) | L2    | `@backend`  | TODO   |
| 8   | TracingModule Bootstrap | [tracing-bootstrap.spec.md](tracing-bootstrap.spec.md) | L2    | `@backend`  | TODO   |
| 9   | API Rate Limiting       | [api-rate-limiting.spec.md](api-rate-limiting.spec.md) | L2    | `@backend`  | TODO   |
| 12  | Wishlist Service + FE   | [wishlist-service.spec.md](wishlist-service.spec.md)   | L3    | `@commerce` | TODO   |

**Invoke:**

```
@backend #file:.github/specs/grpc-wire-modules.spec.md +wrap
@backend #file:.github/specs/tracing-bootstrap.spec.md +wrap
@backend #file:.github/specs/api-rate-limiting.spec.md +wrap
@commerce #file:.github/specs/wishlist-service.spec.md +wrap
```

---

## 🟢 Nhỏ — L1 inline prompt (no spec needed)

| #   | Task                          | Inline Prompt                                                       | Status |
| --- | ----------------------------- | ------------------------------------------------------------------- | ------ |
| 10  | Health check endpoints        | `@backend #file:.github/specs/health-check-endpoints.spec.md +wrap` | TODO   |
| 11  | OrderDeliveredEvent formalize | Inline L1 prompt below                                              | TODO   |

**Task 11 — L1 inline (paste trực tiếp):**

```
@backend Add OrderDeliveredEvent interface to libs/events/src/events.ts.

File: libs/events/src/events.ts
Add after OrderConfirmedEvent:

interface OrderDeliveredEvent extends DomainEvent {
  eventType: 'ORDER_DELIVERED';
  orderId: string;
  userId: string;
  sellerId: string;
  totalAmount: number;
  deliveredAt: string;
  isFirstOrder: boolean;
}

Also add row to libs/events/EVENTS.md:
  order.events already exists — verify ORDER_DELIVERED is documented.

Output: 1 interface addition only.
Verify: npx tsc --noEmit
```

---

## FE-only tasks (backend đã done hoặc sẽ done)

| Task                     | FE File                                         | Depends on                | Status               |
| ------------------------ | ----------------------------------------------- | ------------------------- | -------------------- |
| Search page → real API   | `apps/web/src/app/search/page.tsx`              | qdrant-search-embedding   | TODO                 |
| Home feed → real API     | `apps/web/src/app/page.tsx`                     | feed-ranking-v1           | TODO                 |
| Wishlist page → real API | `apps/web/src/app/wishlist/page.tsx`            | wishlist-service          | Included in spec #12 |
| Seller subscription page | `apps/web/src/app/seller/subscription/page.tsx` | subscription-renewal-cron | TODO                 |
| Admin fraud queue        | `apps/web/src/app/admin/fraud/page.tsx`         | fraud-detection-l1        | TODO                 |

**Invoke FE tasks (sau khi BE done):**

```
@frontend Implement apps/web/src/app/search/page.tsx real API integration.
Read: apps/web/src/lib/api/ pattern. Call GET /api/search?q=&cursor=.
+base +verify-L2
```

---

## Admin-service tasks (chưa có spec)

| Task                    | Note                                               |
| ----------------------- | -------------------------------------------------- |
| Fraud review queue API  | `GET /admin/fraud/queue` — filter REVIEW decisions |
| Seller verification     | `POST /admin/sellers/:id/verify`                   |
| Manual refund override  | `POST /admin/orders/:id/refund`                    |
| Subscription management | `GET/PATCH /admin/subscriptions`                   |

> Tạo spec khi priority cao hơn: `@discovery I want admin fraud review queue. Phase 1 only.`

---

## Dependency graph

```
ScyllaDB (6) ──────────────────► Feed Ranking (2)
Qdrant+Embedding (1) ──────────► Feed Ranking (2) [user embed]
OrderDeliveredEvent (11) ───────► Referral System (3) [isFirstOrder field]
Fraud Detection (4) ────────────► Order flow (blocks bad orders)
Health Checks (10) ─────────────► K8s readiness probes
gRPC Wire (7) ──────────────────► Internal service calls perf
```
