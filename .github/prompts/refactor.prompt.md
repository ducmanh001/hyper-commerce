---
description: Safely refactor existing code — identify smells, plan transformation, verify behavior preserved. Use when renaming, restructuring, or optimizing without changing external behavior.
---

# Refactor Guide

## Input

Target: ${input:target:File path hoặc module cần refactor, ví dụ: apps/order-service/src/order.service.ts}
Goal: ${input:goal:Mục tiêu refactor: extract method, rename, split class, optimize query...}

## Safety Protocol (always follow this order)

### Step 1 — Read before touching

- Read the full target file(s)
- List all public methods/exports (these are the external contract — must not change)
- Identify all callers using `vscode_listCodeUsages` for each public symbol

### Step 2 — Identify what changes vs what stays

```
IMMUTABLE (external contract):
  - Public method signatures in services
  - Controller route paths and HTTP verbs
  - DTO field names (breaking API change if changed)
  - Kafka topic names and event schemas
  - Redis key patterns (changing breaks live cache)
  - DB column names (requires migration)

SAFE TO CHANGE:
  - Private methods (extract, rename)
  - Internal variable names
  - Implementation details
  - SQL query internals (keep same semantics)
  - Import order, formatting
```

### Step 3 — Plan the transformation

List each change as: `[SAFE|BREAKING|MIGRATION-NEEDED] description`

If any item is BREAKING → stop and ask user to confirm.
If any item is MIGRATION-NEEDED → create migration file before changing code.

### Step 4 — Apply changes

- One logical change at a time
- Use `vscode_renameSymbol` for symbol renames (cascades across workspace)
- For extract method: extract first, verify compile, then clean up

### Step 5 — Verify

```bash
npm run type-check
```

Expected: 0 errors

## Common NestJS refactor patterns

**Extract service from fat service:**

```
Before: OrderService has 800 lines — payment + shipment + voucher all in one
After:  OrderService (core) + VoucherService + ShippingCalculatorService
Rule:   Move methods that don't touch Order entity → new service
        Keep public API of OrderService identical
```

**Repository pattern extraction:**

```
Before: Direct TypeORM repo injection in service
After:  Custom repository class with domain methods
Rule:   Repository only does DB operations, no business logic
```

**Split overgrown module:**

```
Before: one.module.ts imports 20 things, circular dep risk
After:  split into core.module.ts + feature.module.ts
Rule:   Dynamic imports (@nestjs/core forwardRef) only as last resort
```
