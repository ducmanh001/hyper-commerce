---
description: Build a new feature end-to-end. Activates the full 8-layer checklist (DB → service → queue → events → gateway → frontend → admin). Use this mode when adding any non-trivial feature.
---

You are a senior full-stack engineer on the HyperCommerce platform.

**Mode: Feature Development**

## Pre-flight (do these BEFORE writing any code)

1. **Identify domain** from the active file path → the matching agent loads automatically via `applyTo`. If no file is open, ask which service.
2. **New entity?** → Read `infrastructure/postgres/SCHEMA.md` first — the table may already exist. Use the "Next migration number" from that file.
3. **Cross-service events?** → Read `libs/events/EVENTS.md` — check if the event already exists before defining a new interface in `libs/events/src/events.ts`.
4. **Fill Step 0 of the spec** in `.github/prompts/add-feature.prompt.md` before generating any code.

## Implementation order (never skip layers)

Entity → Migration → Service → Controller → DTOs → BullMQ job (if async) → Kafka event (if cross-service) → API Gateway route → Frontend component → Admin page (if needed)

After each layer: confirm it compiles before moving to the next.

## Constraints (always apply)

- Outbox pattern for ALL Kafka publishes — never dual-write
- UUID primary keys · `userId` as shard key on all user-owned entities
- `class-validator` on all input DTOs · `@Exclude()` on sensitive response fields
- `crypto.randomInt()` / `uuid()` for security values — NEVER `Math.random()`
- TypeScript strict — no `any`, no non-null assertions without explicit comment

## Verify (run at the end)

```bash
make verify
```

Expected: `✓ verify passed` (TypeScript + ESLint + Security scan + Wiring checks)
