---
feature: TEMPLATE — Replace with feature name
domain: '@backend' # @backend | @commerce | @social | @platform | @ai-ml | @frontend | @architect
level: L2 # L1 | L2 | L3 | L4
status: DRAFT # DRAFT | READY | IN_PROGRESS | DONE
created: YYYY-MM-DD
---

# [Feature Name]

## Goal ← MANDATORY (1 câu, business value)

> Describe what problem this solves and for whom.

## Read First ← MANDATORY (files agent đọc trước khi code)

- `infrastructure/postgres/SCHEMA.md` # nếu có table mới
- `libs/events/EVENTS.md` # nếu có kafka event
- `libs/events/src/events.ts` # nếu cần event interface
- `apps/{service}/src/entities/{entity}.ts` # entity liên quan

## Acceptance Criteria ← MANDATORY

- [ ] AC1: {observable behavior — not implementation detail}
- [ ] AC2:
- [ ] AC3:

## Domain Rules ← MANDATORY nếu không hiển nhiên

- All VND amounts: BIGINT integer dong
- {project-specific rule from SCHEMA.md or copilot-instructions}

## Tasks ← MANDATORY — ordered by dependency

1. {entity / migration} — `apps/{service}/src/entities/`
2. {service logic} — `apps/{service}/src/`
3. {controller / API} — `apps/{service}/src/`
4. {kafka consumer/producer}
5. {module wiring}

## Kafka Events ← nếu có

```
New interface in libs/events/src/events.ts:
  {EventName}: { eventId, eventType, occurredAt, traceId, version, ...fields }
New row in EVENTS.md:
  topic | emitter | consumer(s)
```

## Migration ← nếu có table mới

```
Number: {N} — check SCHEMA.md first
File: infrastructure/postgres/migrations/{N}_{description}.sql
Tables: {list}
Rollback: DROP TABLE {x}; ALTER TABLE {y} DROP COLUMN {z};
```

## Edge Cases ← L3+ recommended

- {edge case} → {how to handle}

## Skip ← MANDATORY — scope control

- {what NOT to implement this iteration}
- Tests (separate spec)
- Frontend (separate spec)

## Fragments ← MANDATORY

+base [+kafka] [+redis] [+tx] [+migration] +verify-L{N}
