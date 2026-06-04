---
description: Write tests for a service, controller, processor, or Kafka consumer. Covers unit + integration + E2E layers.
---

# Write Tests Checklist

## Input

Target: ${input:target:File hoặc class cần test, ví dụ: apps/order-service/src/order.service.ts}
Test type: ${input:testType:unit|integration|e2e|all}

## 1. Unit tests — Service layer

For `${target}`:

- [ ] Happy path: typical input → expected output
- [ ] Edge cases: empty list, zero quantity, null user
- [ ] Error paths: repo throws → service re-throws correct HTTP exception
- [ ] Security paths (nếu có auth): unauthorized → 403, wrong owner → 403
- [ ] Mock ALL external dependencies (repo, Redis, Kafka, HTTP clients)

```typescript
// File: apps/{service}/src/{name}.service.spec.ts
import { Test } from '@nestjs/testing';
// ... mock setup (xem testing.instructions.md)
```

## 2. Unit tests — BullMQ Processor

- [ ] Job success → correct service method called → job không throw
- [ ] Job failure → error logged → job throws (BullMQ sẽ retry)
- [ ] Idempotency: chạy job 2 lần → state consistent

## 3. Unit tests — Kafka Consumer

- [ ] Message arrives → handler gọi đúng service
- [ ] Malformed message → validation error caught, không crash consumer
- [ ] Duplicate message (same eventId) → idempotency check

## 4. Integration tests — Repository

- [ ] Dùng `@testcontainers/postgresql` hoặc in-memory SQLite cho TypeORM
- [ ] Test: save → findById trả đúng
- [ ] Test: soft delete → findById trả null

## 5. E2E tests

- [ ] `apps/{service}/test/app.e2e-spec.ts`
- [ ] POST /resource → 201 + body đúng schema
- [ ] GET /resource/:id với JWT hợp lệ → 200
- [ ] GET /resource/:id không có JWT → 401
- [ ] GET /resource/:id của user khác → 403

## 6. Coverage check

```bash
npx jest --coverage --testPathPattern="apps/{service}"
# Target: ≥ 80% line, 100% branch cho payment + auth + OTP
```

## Anti-patterns — KHÔNG làm

- ĐỪNG mock `crypto` — test với real crypto
- ĐỪNG test implementation details — test behavior/output
- ĐỪNG skip error path tests — đây là nơi bugs ẩn nhất
