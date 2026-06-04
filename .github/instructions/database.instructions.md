---
applyTo: 'infrastructure/**,apps/*/src/entities/**'
---

# Database & Infrastructure Conventions

## BEFORE writing any migration — schema snapshot

**Read `infrastructure/postgres/SCHEMA.md` first.**

- Lists all 25 existing tables with columns, indexes, FK relationships
- Check if the table already exists → use `ALTER TABLE` not `CREATE TABLE`
- Next migration number is at the top of that file — use it, then increment it
- After adding a migration, update "Next migration number" in SCHEMA.md

## TypeORM migrations (NEVER synchronize in prod)

- Migration file naming: `{timestamp}-{description}.ts`
- Always include `up()` AND `down()` for reversibility
- Index every foreign key and frequently-queried column
- Use `gen_random_uuid()` for UUID defaults (PostgreSQL 13+)

## PostgreSQL naming conventions

- Tables: `snake_case` (e.g. `order_items`, `review_helpfuls`)
- Columns: `snake_case`
- Indexes: `idx_{table}_{columns}` e.g. `idx_reviews_product_status`
- Constraints: `uq_{table}_{columns}`, `fk_{table}_{ref}`
- Shard key: all user-owned tables must have `user_id UUID NOT NULL`

## Redis key naming

```
{service-prefix}:{entity}:{id}[:{sub-id}]
inv:stock:{productId}:{variantId}   ← inventory
order:lock:{idempotencyKey}          ← distributed lock (10s TTL)
inv:reserve:{reservationId}          ← MUST set 15min TTL
product:rating:{productId}           ← 5min TTL
rl:{ip}:{path}:{window}              ← rate limiting
```

## Kafka topics naming

- Pattern: `{domain}.{event_past_tense}` e.g. `order.created`, `review.published`
- DLQ: `{topic}.dlq` e.g. `order.created.dlq`
- Add new topics to `libs/events/src/events.ts` before using

## Docker Compose additions checklist

When adding a new service:

1. Use `<<: *nestjs-base` anchor for NestJS services
2. Map port `127.0.0.1:{port}:{port}` (never `0.0.0.0` in dev)
3. Add named volume if service needs persistence
4. Add to `depends_on` for `postgres` and `redis`
5. Add `healthcheck`

## Security rules

- Admin service: MUST use `127.0.0.1:3011:3011` binding (never `0.0.0.0`)
- Secrets: env vars only, never in source code or docker-compose
- Kafka in prod: SASL/mTLS required
- Elasticsearch in prod: xpack.security MUST be enabled
