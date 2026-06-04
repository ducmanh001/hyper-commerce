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
