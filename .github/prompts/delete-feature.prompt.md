---
description: Safely delete a feature — cascade through all layers (DB, service, queue, events, gateway, frontend, admin) to leave no dead code or orphaned references.
---

# Delete Feature Checklist

## Input

Feature to delete: ${input:featureName:Tên feature hoặc file/module cần xóa}
Reason: ${input:reason:Tại sao xóa: deprecated, replaced by X, business decision...}

## DANGER ZONES — check these first before deleting anything

```
STOP if any of these is true:
  [ ] Other services consume the Kafka topic this feature produces
  [ ] Active API clients (mobile app, partner APIs) call these endpoints
  [ ] DB columns have data that needs migration/archiving
  [ ] Feature is behind a feature flag (disable flag first, then delete after 1 sprint)
```

## Deletion Order (always bottom-up, reverse of add)

### Step 1 — Find all references

For each public symbol in the feature, run `vscode_listCodeUsages`.
List every file that imports or calls it.

### Step 2 — Frontend first (safest, user-facing)

- [ ] Remove page: `apps/web/src/app/{route}/page.tsx`
- [ ] Remove components: `apps/web/src/components/{domain}/{Name}.tsx`
- [ ] Remove from navigation/menu if present
- [ ] Remove API client functions from `apps/web/src/lib/api-client.ts`
- [ ] Remove from admin panel if present

### Step 3 — API Gateway routes

- [ ] Remove proxy routes from `apps/api-gateway/server.js`
- [ ] Remove service URL from `INTERNAL_SERVICES` if service is being fully deleted

### Step 4 — Service layer

- [ ] Remove controller endpoints
- [ ] Remove service methods
- [ ] Remove BullMQ processor jobs for this feature
- [ ] Remove from module imports/providers/exports

### Step 5 — Queue layer

- [ ] Remove from `QUEUE_NAMES` / `JOB_NAMES` in `libs/queue/src/constants/queue.constants.ts`
  - Only if no other feature uses this queue

### Step 6 — Kafka events

- [ ] Remove event interfaces from `libs/events/src/events.ts`
  - Only if no consumer exists anywhere (search for topic name first)
- [ ] Remove `@EventPattern('topic.name')` handlers in all consuming services

### Step 7 — Data layer (most dangerous — do last)

- [ ] Create a DROP TABLE migration (or ALTER TABLE DROP COLUMN)
  - File: `infrastructure/postgres/migrations/{N}_drop_{feature}.sql`
  - Include: archive strategy if data has value
- [ ] Remove entity file
- [ ] Remove from `TypeOrmModule.forFeature([...])` in module

### Step 8 — Verify

```bash
# 0 TypeScript errors
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v tsbuildinfo

# No dead imports
grep -r "import.*{FeatureName}" apps/ libs/ --include="*.ts"
```

## If deleting an entire service

Additional steps:

- [ ] Remove from `nest-cli.json`
- [ ] Remove from `docker-compose.yml`
- [ ] Remove from Kubernetes manifests: `infrastructure/kubernetes/services/`
- [ ] Remove Prometheus scrape target
- [ ] Remove from orchestrator.agent.md port map
- [ ] Archive or delete the `apps/{service}/` directory
