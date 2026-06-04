---
description: Migrate or restructure services — split one service into two, merge two services, extract shared logic to a lib, or perform breaking schema changes. Use for any structural change that touches multiple files.
---

# Service Migration Guide

## Input

Migration type: ${input:migrationType:split-service|merge-services|extract-lib|schema-migration|system-upgrade}
Source: ${input:source:Service(s) hoặc module nguồn}
Target: ${input:target:Service(s) hoặc module đích}
Description: ${input:description:Mô tả migration}

---

## Type A: Split one service into two

**When to split:** Service > 1000 LOC, two bounded contexts sharing one DB, different scaling needs.

### Protocol

1. **Define the boundary first** — which domain objects belong to each new service?
2. **Shared DB → keep one owner**, other queries via REST/Kafka
3. **No shared entity files** — duplicate the entity if needed, diverge later
4. **Deploy order:** new service up → route % traffic → kill old → remove dead code

### Checklist

- [ ] New service directory: `apps/{new-service}/`
- [ ] Copy entities that belong to new service
- [ ] Write Kafka event to replace direct method calls between the two services
- [ ] Update API Gateway: add new service routes, keep old routes pointing to new owner
- [ ] Add to `nest-cli.json`, `docker-compose.yml`, K8s
- [ ] Update orchestrator.agent.md port map
- [ ] Create DB migration if tables need to move schemas
- [ ] Create new agent file or update existing domain agent's `applyTo`

---

## Type B: Merge two services into one

**When to merge:** Two services always deploy together, single DB, <200 req/s combined.

### Checklist

- [ ] Identify the primary service (keeps the port/name)
- [ ] Move all entities, services, controllers from secondary → primary
- [ ] Update all cross-service Kafka events → direct method calls (remove Kafka overhead)
- [ ] Keep the secondary service running for 1 sprint (return 301/proxy) before killing
- [ ] Remove secondary from `nest-cli.json`, `docker-compose.yml`, K8s
- [ ] DB: merge schemas if on separate databases (migration required)

---

## Type C: Extract shared logic to a lib

**When to extract:** Same code in 2+ services, needs versioning, publish as internal package.

### Checklist

- [ ] New lib: `libs/{name}/src/`
- [ ] `libs/{name}/src/index.ts` — barrel export
- [ ] `tsconfig.base.json` paths: `@hypercommerce/{name}` → `libs/{name}/src/index`
- [ ] `nest-cli.json` library entry
- [ ] Update all consuming services to import from `@hypercommerce/{name}`
- [ ] Remove duplicated code from each service

---

## Type D: Breaking DB schema migration

**When:** Rename column, change type, split table, denormalize.

### Zero-downtime protocol (expand-contract pattern)

```
Phase 1 — Expand (deploy, no downtime)
  + Add new column/table (nullable)
  + Write code that writes to BOTH old and new

Phase 2 — Migrate data (background job)
  + Backfill new column from old
  + Verify: SELECT COUNT(*) WHERE new_col IS NULL = 0

Phase 3 — Contract (deploy, no downtime)
  + Switch reads to new column
  + Stop writing to old column
  + Schedule drop after 2 weeks
```

### Migration file template

```sql
-- Phase 1 (deploy immediately)
ALTER TABLE {table} ADD COLUMN {new_col} {type};

-- Phase 2 (run as background job)
UPDATE {table} SET {new_col} = {expression} WHERE {new_col} IS NULL;

-- Phase 3 (deploy after data verified)
-- ALTER TABLE {table} DROP COLUMN {old_col};  ← uncomment in next PR
```

---

## Type E: System-wide upgrade (Node.js, NestJS, TypeScript version)

### Checklist

- [ ] Check breaking changes in CHANGELOG of upgraded package
- [ ] Upgrade in a branch, never main directly
- [ ] Run `npx tsc --noEmit` after upgrade
- [ ] Run `npm audit` — resolve HIGH/CRITICAL
- [ ] Test locally with `docker compose up` before pushing
- [ ] Update Dockerfile base image if Node.js version changed
