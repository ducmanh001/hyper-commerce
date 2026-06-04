# gRPC Services Catalog

> Auto-generated from `libs/grpc/src/proto/*.proto`
> Last updated: 2026-06-04 — do not edit manually, changes will be overwritten.

---

## Routing Table

| Service            | Proto file        | Port     | Implements        | Called by                                |
| ------------------ | ----------------- | -------- | ----------------- | ---------------------------------------- |
| `InventoryService` | `inventory.proto` | `:50052` | inventory-service | order-service, flash-sale                |
| `OrderService`     | `order.proto`     | `:50053` | order-service     | payment-service, analytics               |
| `PaymentService`   | `payment.proto`   | `:50054` | payment-service   | order-service, admin-service             |
| `SearchService`    | `search.proto`    | `:50055` | search-service    | api-gateway, feed-service                |
| `UserService`      | `user.proto`      | `:50051` | user-service      | feed-service, live-service, notification |

---

## InventoryService — `hypercommerce.inventory`

| Method               | Request                                                | Response                     | Notes                                      |
| -------------------- | ------------------------------------------------------ | ---------------------------- | ------------------------------------------ |
| `CheckStock`         | `CheckStockRequest` (product_id, variant_id, quantity) | `CheckStockResponse`         |                                            |
| `CheckStockBatch`    | `CheckStockBatchRequest` (items)                       | `CheckStockBatchResponse`    |                                            |
| `ReserveStock`       | `ReserveStockRequest` (order_id, items, ttl_seconds)   | `ReserveStockResponse`       | how long to hold reservation (default 600) |
| `ReleaseReservation` | `ReleaseReservationRequest` (reservation_id, order_id) | `ReleaseReservationResponse` |                                            |
| `CommitReservation`  | `CommitReservationRequest` (reservation_id, order_id)  | `CommitReservationResponse`  |                                            |
| `GetFlashSaleStock`  | `GetFlashSaleStockRequest` (flash_sale_id)             | `GetFlashSaleStockResponse`  |                                            |

---

## OrderService — `hypercommerce.order`

| Method              | Request                                               | Response                    | Notes                              |
| ------------------- | ----------------------------------------------------- | --------------------------- | ---------------------------------- |
| `GetOrder`          | `GetOrderRequest` (order_id)                          | `OrderResponse`             |                                    |
| `GetOrderBatch`     | `GetOrderBatchRequest` (order_ids)                    | `GetOrderBatchResponse`     |                                    |
| `UpdateOrderStatus` | `UpdateOrderStatusRequest` (order_id, status, reason) | `UpdateOrderStatusResponse` | optional reason (for cancellation) |
| `GetOrdersByUser`   | `GetOrdersByUserRequest` (user_id, page, page_size)   | `GetOrdersByUserResponse`   | optional status filter             |
| `CancelOrder`       | `CancelOrderRequest` (order_id, user_id, reason)      | `CancelOrderResponse`       |                                    |

---

## PaymentService — `hypercommerce.payment`

| Method              | Request                                             | Response                | Notes                                   |
| ------------------- | --------------------------------------------------- | ----------------------- | --------------------------------------- |
| `GetPaymentStatus`  | `GetPaymentStatusRequest` (payment_id)              | `PaymentStatusResponse` |                                         |
| `GetPaymentByOrder` | `GetPaymentByOrderRequest` (order_id)               | `PaymentStatusResponse` |                                         |
| `RefundPayment`     | `RefundPaymentRequest` (payment_id, amount, reason) | `RefundPaymentResponse` | partial refund amount (0 = full refund) |

---

## SearchService — `hypercommerce.search`

| Method         | Request                                                | Response               | Notes                         |
| -------------- | ------------------------------------------------------ | ---------------------- | ----------------------------- |
| `Search`       | `SearchRequest` (query, user_id, categories)           | `SearchResponse`       | for personalized ranking      |
| `Autocomplete` | `AutocompleteRequest` (prefix, limit, user_id)         | `AutocompleteResponse` | for personalized autocomplete |
| `Suggest`      | `SuggestRequest` (product_id, user_id, limit)          | `SuggestResponse`      |                               |
| `IndexProduct` | `IndexProductRequest` (product_id, title, description) | `IndexProductResponse` |                               |

---

## UserService — `hypercommerce.user`

| Method             | Request                                      | Response                   | Notes                                          |
| ------------------ | -------------------------------------------- | -------------------------- | ---------------------------------------------- |
| `GetUser`          | `GetUserRequest` (user_id, fields)           | `UserResponse`             | field mask — only return requested fields      |
| `GetUserBatch`     | `GetUserBatchRequest` (user_ids, fields)     | `GetUserBatchResponse`     |                                                |
| `GetUserProfile`   | `GetUserProfileRequest` (user_id, viewer_id) | `UserProfileResponse`      | for personalized response (is_following, etc.) |
| `CheckUserExists`  | `CheckUserExistsRequest` (user_id)           | `CheckUserExistsResponse`  |                                                |
| `GetFollowerCount` | `GetFollowerCountRequest` (user_id)          | `GetFollowerCountResponse` |                                                |

---

## Client Usage Pattern

```typescript
@Client({
  transport: Transport.GRPC,
  options: {
    package: 'hypercommerce.{service}',
    protoPath: join(__dirname, '../proto/{service}.proto'),
    url: 'localhost:{port}',
  },
})
private grpcClient: ClientGrpc;

onModuleInit() {
  this.svc = this.grpcClient.getService<ServiceInterface>('{ServiceName}');
}

// Call (returns Observable — wrap with firstValueFrom):
const result = await firstValueFrom(this.svc.methodName(request));
```

---

## gRPC Status → HTTP mapping

| gRPC Status               | HTTP | Scenario                      |
| ------------------------- | ---- | ----------------------------- |
| `NOT_FOUND (5)`           | 404  | Resource not found            |
| `INVALID_ARGUMENT (3)`    | 400  | Bad input                     |
| `FAILED_PRECONDITION (9)` | 409  | Insufficient stock / conflict |
| `UNAUTHENTICATED (16)`    | 401  | Missing/invalid token         |
| `UNAVAILABLE (14)`        | 503  | Service down                  |
