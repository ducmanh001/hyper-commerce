# gRPC Services Catalog

> On-demand reference — read when writing gRPC client stubs or server implementations.
> Proto files: `libs/grpc/src/proto/*.proto`
> Package prefix: `hypercommerce.{service}`

---

## Routing Table

| Service            | Proto file        | Implements                 | Called by                                |
| ------------------ | ----------------- | -------------------------- | ---------------------------------------- |
| `InventoryService` | `inventory.proto` | inventory-service `:50052` | order-service, flash-sale                |
| `OrderService`     | `order.proto`     | order-service `:50053`     | payment-service, analytics               |
| `PaymentService`   | `payment.proto`   | payment-service `:50054`   | order-service, admin-service             |
| `SearchService`    | `search.proto`    | search-service `:50055`    | api-gateway, feed-service                |
| `UserService`      | `user.proto`      | user-service `:50051`      | feed-service, live-service, notification |

---

## InventoryService — `hypercommerce.inventory`

| Method               | Request → Response                                                                 | Notes                                 |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `CheckStock`         | `(productId, variantId, quantity)` → `(available, availableQty, isFlashSale)`      | Single item check                     |
| `CheckStockBatch`    | `(items[])` → `(results[], allAvailable)`                                          | Batch check — use for cart validation |
| `ReserveStock`       | `(orderId, items[], ttlSeconds)` → `(success, reservationId, insufficientItems[])` | Default TTL=600s (10min)              |
| `ReleaseReservation` | `(reservationId, orderId)` → `(success)`                                           | Call on order cancel                  |
| `CommitReservation`  | `(reservationId, orderId)` → `(success)`                                           | Call on payment confirmed             |
| `GetFlashSaleStock`  | `(flashSaleId)` → `(remaining, total, active, endsAt)`                             | Real-time countdown                   |

---

## OrderService — `hypercommerce.order`

| Method              | Request → Response                                                      | Notes                                                                 |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GetOrder`          | `(orderId)` → `OrderResponse`                                           | Single order lookup                                                   |
| `GetOrderBatch`     | `(orderIds[])` → `(orders[])`                                           | Batch — use for analytics/admin                                       |
| `UpdateOrderStatus` | `(orderId, status, reason, updatedBy)` → `(success, newStatus)`         | status: PENDING\|CONFIRMED\|PROCESSING\|SHIPPED\|DELIVERED\|CANCELLED |
| `GetOrdersByUser`   | `(userId, page, pageSize, statusFilter)` → `(orders[], total, hasMore)` | Paginated                                                             |
| `CancelOrder`       | `(orderId, userId, reason)` → `(success, message)`                      | User-initiated cancel                                                 |

**OrderResponse fields:** `id, userId, status, totalAmount (VND), currency, items[], shippingAddressJson, createdAt, paymentId`

---

## PaymentService — `hypercommerce.payment`

| Method              | Request → Response                                                 | Notes                  |
| ------------------- | ------------------------------------------------------------------ | ---------------------- |
| `GetPaymentStatus`  | `(paymentId)` → `PaymentStatusResponse`                            | By payment ID          |
| `GetPaymentByOrder` | `(orderId)` → `PaymentStatusResponse`                              | By order ID            |
| `RefundPayment`     | `(paymentId, amount, reason, requestedBy)` → `(success, refundId)` | amount=0 → full refund |

**PaymentStatusResponse fields:** `paymentId, orderId, status (PENDING\|PROCESSING\|COMPLETED\|FAILED\|REFUNDED), method (stripe\|vnpay\|momo\|cod), amount (VND), gatewayTransactionId`

---

## SearchService — `hypercommerce.search`

| Method         | Request → Response                                                                                                                                  | Notes                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `Search`       | `(query, userId, categories[], minPrice, maxPrice, page, pageSize, sortBy, useVectorSearch, useRRF)` → `(hits[], total, pages, queryId, latencyMs)` | Full text + optional semantic           |
| `Autocomplete` | `(prefix, limit, userId)` → `(suggestions[])`                                                                                                       | Type: keyword\|product\|category\|brand |
| `Suggest`      | `(productId, userId, limit)` → `(products[])`                                                                                                       | Related products                        |
| `IndexProduct` | `(productId, title, description, category, price, tags[], brand, isActive)` → `(success, indexId)`                                                  | Call from product-service on upsert     |

**SearchHit fields:** `productId, title, price, thumbnailUrl, category, relevanceScore, rrfScore, isFlashSale, stock`

---

## UserService — `hypercommerce.user`

| Method             | Request → Response                                                                 | Notes                                            |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GetUser`          | `(userId, fields[])` → `UserResponse`                                              | fields = field mask — request only needed fields |
| `GetUserBatch`     | `(userIds[], fields[])` → `(users[])`                                              | Batch lookup — use for feed/notification         |
| `GetUserProfile`   | `(userId, viewerId)` → `(user, isFollowing, isBlocked, postCount, followingCount)` | viewerId for personalized response               |
| `CheckUserExists`  | `(userId)` → `(exists)`                                                            | Lightweight existence check                      |
| `GetFollowerCount` | `(userId)` → `(count)`                                                             | For celebrity detection (>10K = celebrity)       |

**UserResponse fields:** `id, username, email, avatarUrl, displayName, isCelebrity, followerCount, createdAt`

---

## Client Usage Pattern

```typescript
// In a service that calls InventoryService
@Client({
  transport: Transport.GRPC,
  options: {
    package: 'hypercommerce.inventory',
    protoPath: join(__dirname, '../proto/inventory.proto'),
    url: 'localhost:50052',
  },
})
private inventoryClient: ClientGrpc;

private inventoryService: InventoryService;

onModuleInit() {
  this.inventoryService = this.inventoryClient
    .getService<InventoryService>('InventoryService');
}

// Call:
const result = await firstValueFrom(
  this.inventoryService.checkStock({ productId, variantId, quantity: 1 })
);
```

---

## Error Codes (gRPC status)

| Scenario            | gRPC Status               | HTTP equivalent |
| ------------------- | ------------------------- | --------------- |
| Resource not found  | `NOT_FOUND (5)`           | 404             |
| Invalid input       | `INVALID_ARGUMENT (3)`    | 400             |
| Insufficient stock  | `FAILED_PRECONDITION (9)` | 409             |
| Unauthorized        | `UNAUTHENTICATED (16)`    | 401             |
| Service unavailable | `UNAVAILABLE (14)`        | 503             |
