---
description: Add a new feature end-to-end — spec → DB → service → queue → event → gateway → frontend → admin → self-verify. Fill the spec section before implementing.
---

# Add Feature — Spec-Driven Checklist

## ⚡ Scope Gate (LCB v3 L8 — run before anything else)

Count these numbers and fill in:

```
New tables needed:        ___   (if > 3  → STOP)
New API endpoints:        ___   (if > 8  → STOP)
Kafka events emitted:     ___   (if > 3  → STOP)
Services touched:         ___   (if > 3  → STOP)
```

**If any STOP triggers** → this is too big for one `/add-feature`. Break it:

```
Sub-task 1: /add-feature  ← data layer only (entity + migration)
Sub-task 2: /add-feature  ← service + controller + gateway
Sub-task 3: /add-feature  ← frontend + admin
```

If all within limits → continue to Step 0.

## Step 0 — Write the spec FIRST (fill this before coding anything)

**Feature name**: ${input:featureName:e.g. product-wishlist}
**Domain service**: ${input:service:e.g. user-service :3001}
**What it does**: ${input:description:1-sentence description}

### Spec: Data

```
New tables needed:    (check SCHEMA.md — table may already exist!)
  - table_name: key columns
Existing tables modified:
  - table_name: ADD COLUMN col_name type
```

### Spec: API Endpoints

```
POST   /api/v1/{resource}          body: {...}   auth: required/public
GET    /api/v1/{resource}/:id                    auth: required/public
DELETE /api/v1/{resource}/:id                    auth: owner-only
```

### Spec: Events (cross-service only)

```
Emits:    topic.name  →  consumed by: service-name (what it does)
Consumes: topic.name  ←  emitted by: service-name
```

### Spec: UI

```
New pages:      /route  (Server/Client Component)
New components: ComponentName  (where used)
Admin panel:    yes / no
```

---

## Step 1 — Data Layer

- [ ] Check `infrastructure/postgres/SCHEMA.md` — does table already exist?
- [ ] Entity: `apps/{service}/src/entities/{name}.entity.ts`
  - `extends BaseEntity` from `@hypercommerce/database`
  - `@PrimaryGeneratedColumn('uuid')`, include `userId` as shard key
  - Soft delete: `@DeleteDateColumn()` if applicable
- [ ] Migration: `infrastructure/postgres/migrations/{N}_{feature}_tables.sql`
  - N = "Next migration number" from SCHEMA.md
  - CREATE TABLE + all indexes + FK constraints
  - Rollback comment at bottom: `-- ROLLBACK: DROP TABLE {name};`
  - **Update SCHEMA.md after**: add table + increment "Next migration number"
- [ ] Register entity in module: `TypeOrmModule.forFeature([EntityName])`

## Step 2 — Service Layer

- [ ] `apps/{service}/src/{name}.service.ts`
  - Business logic only — no `res`/`req` objects
  - Throw `NotFoundException` / `ConflictException` / `ForbiddenException`
  - Ownership check: verify `entity.userId === currentUserId` before mutate
- [ ] Add to module `providers: [ServiceName]`

## Step 3 — Controller + DTOs

- [ ] `apps/{service}/src/{name}.controller.ts`
  - `@UseGuards(JwtAuthGuard)` on protected endpoints
  - `@Roles(Role.ADMIN)` for admin-only
  - Delegate to service — zero business logic in controller
- [ ] `CreateXxxDto`, `UpdateXxxDto`, `XxxResponseDto` with `class-validator`
  - `@Exclude()` on sensitive fields in response DTO
- [ ] Add controller to module `controllers: [ControllerName]`

## Step 4 — Queue Layer (async processing only)

- [ ] Add to `libs/queue/src/constants/queue.constants.ts`:
  ```typescript
  QUEUE_NAMES: {
    MY_QUEUE: 'my:queue';
  }
  JOB_NAMES: {
    MY_JOB: 'my-job';
  }
  ```
- [ ] Processor: `apps/{service}/src/processors/{name}.processor.ts`
  - `@Processor(QUEUE_NAMES.MY_QUEUE)` + `extends WorkerHost`
- [ ] Register: add processor to module `providers: [ProcessorName]`

## Step 5 — Kafka Events (cross-service only)

- [ ] Add interfaces to `libs/events/src/events.ts` extending `DomainEvent`
- [ ] Publish via `KafkaProducerService` — **object literal, NOT JSON.stringify()**
- [ ] Consumer: `@EventPattern('topic.name')` in consuming service

## Step 6 — API Gateway

- [ ] Add to `INTERNAL_SERVICES` in `apps/api-gateway/server.js` (if new service)
- [ ] Add proxy routes — specify auth level: none / `authMiddleware` / admin check

## Step 7 — Frontend

- [ ] API function in `apps/web/src/lib/api-client.ts` — throw on non-ok, no mock fallback
- [ ] Component: Server Component for display, `{Name}Client.tsx` for interactions
- [ ] Page: `apps/web/src/app/{route}/page.tsx`
- [ ] Cache key + TTL added to TanStack Query (see frontend.agent.md)

## Step 8 — Admin Panel (if needed)

- [ ] Admin controller with `@Roles(Role.ADMIN)` guard
- [ ] Admin gateway route with role check
- [ ] Admin web page: `apps/web/src/app/admin/{feature}/page.tsx`

---

## Step 9 — Self-Verify Checklist (run BEFORE make verify)

Go through each item. If any box is unchecked, fix it before proceeding.

**Data layer**

- [ ] Entity file exists and extends BaseEntity
- [ ] Entity registered in `TypeOrmModule.forFeature([...])` in the module
- [ ] Migration file exists with correct sequential number
- [ ] SCHEMA.md updated

**Service layer**

- [ ] Service in module `providers`
- [ ] Controller in module `controllers`
- [ ] All DTOs have `class-validator` decorators

**Queue (if used)**

- [ ] Queue name in `QUEUE_NAMES`, job name in `JOB_NAMES`
- [ ] Processor in module `providers`
- [ ] `BullModule.registerQueue({ name: QUEUE_NAMES.X })` in module `imports`

**Events (if used)**

- [ ] Event interface exported from `libs/events/src/events.ts`
- [ ] Producer uses object literal (not `JSON.stringify`)
- [ ] Consumer service imports `EventPattern` and handles the topic

**Gateway + Frontend**

- [ ] Proxy route added to `apps/api-gateway/server.js`
- [ ] API client function throws on non-ok (no mock fallback)
- [ ] Page uses correct Server/Client Component split

**Run validator**

```bash
make verify
```

Expected: `✓ verify passed`

---

## Step 10 — Structured Handoff (LCB v3 L4)

After completing, output this block so the next task or agent can pick up cleanly:

```json
{
  "task": "<feature name from Step 0>",
  "files_modified": [
    "apps/{service}/src/entities/{name}.entity.ts",
    "apps/{service}/src/{name}.service.ts",
    "apps/{service}/src/{name}.controller.ts",
    "infrastructure/postgres/migrations/{N}_{feature}.sql"
  ],
  "decisions": "<key technical decision ≤50 words — e.g. used soft-delete, no Kafka needed, chose BullMQ for async>",
  "next_hint": "<what to build or check next, e.g. 'add admin report endpoint' or 'wire Kafka consumer in notification-service'>",
  "verify_status": "make verify: passed",
  "context_approx": "~NNNN tokens"
}
```

> Principle (LCB v3): handoff ≠ conversation history. Only pass what the next agent cannot self-retrieve.
