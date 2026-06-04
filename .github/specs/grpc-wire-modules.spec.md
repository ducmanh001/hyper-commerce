---
feature: gRPC Dead Code — Wire Controllers into Modules
domain: '@backend'
level: L2
status: READY
created: 2026-06-05
related-fe: none
---

# gRPC Dead Code — Wire 4 Controllers into Modules

## Goal

4 services có gRPC controller files nhưng chưa import vào module → dead code. Wire chúng để gRPC transport hoạt động.

## Read First

- `apps/inventory-service/src/grpc/inventory.grpc.controller.ts`
- `apps/order-service/src/grpc/order.grpc.controller.ts`
- `apps/payment-service/src/grpc/payment.grpc.controller.ts`
- `apps/search-service/src/grpc/search.grpc.controller.ts`
- `libs/grpc/src/` ← proto definitions

## Acceptance Criteria

- [ ] AC1: Mỗi service register gRPC controller trong module `controllers` array
- [ ] AC2: `main.ts` mỗi service `connectMicroservice` với Transport.GRPC
- [ ] AC3: `npx tsc --noEmit` = 0 errors sau khi wire
- [ ] AC4: Port gRPC: inventory=50052 | order=50053 | payment=50054 | search=50055

## Domain Rules

- user-service đã wired (port 50051) — đây là pattern để follow
- Mỗi service chỉ thêm import + `connectMicroservice` — KHÔNG tạo RPC method mới
- gRPC proto files đã có trong `libs/grpc/src/` — chỉ wire, không thay đổi interface

## Tasks

### inventory-service

1. Import `InventoryGrpcController` vào `InventoryModule` controllers array
2. Add `connectMicroservice` Transport.GRPC port=50052 trong `main.ts`

### order-service

3. Import `OrderGrpcController` vào `OrderModule` controllers array
4. Add `connectMicroservice` Transport.GRPC port=50053 trong `main.ts`

### payment-service

5. Import `PaymentGrpcController` vào `PaymentModule` controllers array
6. Add `connectMicroservice` Transport.GRPC port=50054 trong `main.ts`

### search-service

7. Import `SearchGrpcController` vào `SearchModule` controllers array
8. Add `connectMicroservice` Transport.GRPC port=50055 trong `main.ts`

## Edge Cases

- `app.startAllMicroservices()` cần gọi TRƯỚC `app.listen()` trong main.ts

## Skip

- Tạo RPC methods mới — chỉ wire existing
- Client stubs trong calling services — separate task
- Load balancing / service mesh

## Fragments

+base +verify-L2
