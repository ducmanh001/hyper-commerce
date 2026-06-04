---
applyTo: 'apps/*-service/**/*.ts,libs/**/*.ts'
---

# NestJS / TypeScript Code Conventions

## Module pattern (mandatory)

- `controller → service → repository` — no business logic in controllers
- Inject via constructor, never `new` directly: `constructor(private readonly svc: MyService) {}`
- Guard order: `@UseGuards(JwtAuthGuard, RolesGuard)` THEN `@Roles(Role.SELLER)`
- Export only what other modules need in `exports: [ServiceName]`

## DTOs

- Separate `CreateXxxDto`, `UpdateXxxDto`, `XxxResponseDto`
- All inputs: `class-validator` decorators (`@IsString()`, `@IsUUID()`, `@IsOptional()`)
- `@Exclude()` sensitive fields in response DTOs

## Entity rules

- Extend `BaseEntity` from `libs/database`
- UUID primary key: `@PrimaryGeneratedColumn('uuid')`
- Soft delete: `@DeleteDateColumn() deletedAt?: Date`
- Shard key `userId` on all user-owned tables
- NEVER use `synchronize: true` in production

## Error handling

- Throw `HttpException` subclasses: `NotFoundException`, `ConflictException`, `ForbiddenException`
- Include `ErrorCode` enum value in message
- Never expose internal stack traces in HTTP responses

## Kafka (always include correlationId)

```typescript
await this.kafka.publish({
  topic: 'event.name',
  partitionKey: userId,
  value: {
    eventId: uuid(),
    eventType: 'EVENT_NAME',
    occurredAt: new Date().toISOString(),
    traceId: uuid(),
    version: 1,
    ...payload,
  },
});
```

## Redis

- `this.redis.set(key, value, ttlSeconds)` — always set TTL
- Atomic operations: use Lua scripts via `RedisClientService.eval()`
- Key naming: `{service}:{entity}:{id}` e.g. `inv:stock:{productId}:{variantId}`
- Never store PII in Redis keys

## BullMQ processor

```typescript
@Processor(QUEUE_NAMES.MY_QUEUE)
export class MyProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.MY_JOB: ...
    }
  }
}
```

## Outbox Pattern (order-service, payment-service)

- Save `OutboxEvent` in the SAME transaction as the domain entity
- `OutboxProcessorService` polls every 5s and publishes to Kafka
- NEVER publish to Kafka directly from a saga without outbox

## Self-Update Rules (run AFTER implementation — mandatory)

**After creating any entity file** → run in terminal:

```
node scripts/gen-context-index.js
```

This auto-refreshes SCHEMA.md table map + migration number from live @Entity decorators. Do NOT edit SCHEMA.md table map manually.

**After adding any Kafka emit/publish** → two places to update:

1. `libs/events/src/events.ts` — add the TypeScript interface (source of truth for payload)
2. `libs/events/EVENTS.md` — add row to routing table (topic | emitter | consumer(s) only, no payload details)
3. If it's part of a saga flow → update the saga diagram in EVENTS.md

**After creating a new NestJS service** → update `apps/api-gateway/server.js`:

- Add proxy route following existing `createProxyMiddleware` pattern
- Add port to service map in `copilot-instructions.md`

**After adding a BullMQ queue or job** → update `libs/queue/src/constants/queue.constants.ts`:

- Add to `QUEUES` enum and `JOBS` enum, never hardcode queue/job name strings inline

**After fixing a recurring bug or discovering a project-specific anti-pattern** → add to `.github/PATTERNS.md`:

- Format: section header (domain) → pattern name → ❌ wrong code → ✅ correct code → why
