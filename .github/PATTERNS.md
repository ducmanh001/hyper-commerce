# Learned Patterns (LCB v3 L6)

> Accumulated from past tasks. Load on demand — not auto-loaded.
> Update this file when you discover a pattern, fix a recurring mistake, or confirm a preferred approach.

---

## Security

### OTP generation — use `crypto.randomInt`, not `Math.random`

```ts
// ✅ Correct
import { randomInt } from 'crypto';
const otp = randomInt(100000, 999999).toString();

// ❌ Wrong — not cryptographically secure
const otp = Math.floor(Math.random() * 900000 + 100000).toString();
```

### Never use MOCK\_ imports in production paths

- `MOCK_*` constants are test-only
- Grep signal: `grep -r "MOCK_" apps/` should return 0 results in production code

---

## Service Patterns

### Mock fallback → throw instead

```ts
// ❌ Wrong — silently returns fake data in production
if (!this.externalService) return MOCK_DATA;

// ✅ Correct — fail loud
if (!this.externalService) throw new ServiceUnavailableException('externalService not configured');
```

### Entity must be in TypeORM forFeature()

- Every `@Entity()` class must appear in its module's `TypeOrmModule.forFeature([...])`
- Verify: `grep -r "forFeature" apps/{service}/src` should include all entities

### gRPC ClientProxy injection — use @Inject(SERVICE_TOKEN)

```ts
constructor(@Inject('ORDER_SERVICE') private orderClient: ClientGrpc) {}
```

---

## Database

### Migration sequence — no gaps

- File naming: `{N}_{snake_case_description}.sql` where N is sequential
- Check `infrastructure/postgres/SCHEMA.md` for next migration number before creating
- Gap in sequence = `make verify` fails (check 4/4)

### Soft delete pattern

- Use `deleted_at TIMESTAMP` column + `@DeleteDateColumn()` decorator
- Never use `is_deleted BOOLEAN` — can't query deletion time

---

## Kafka / Events

### Outbox pattern — never dual-write

```ts
// ✅ Correct — save OutboxEvent in SAME transaction
await queryRunner.manager.save(order);
await queryRunner.manager.save(OutboxEvent.from(order));

// ❌ Wrong — Kafka publish outside transaction
await this.orderRepo.save(order);
await this.kafkaProducer.send('order.created', order); // dual-write risk
```

### Event naming convention

- Topic: `{domain}.{noun}` e.g. `order.created`
- Always check `libs/events/EVENTS.md` before creating a new topic

---

## Frontend (Next.js)

### Server Component data fetch — no useEffect

```tsx
// ✅ Correct — Server Component
export default async function Page() {
  const data = await fetchData();
  return <Component data={data} />;
}

// ❌ Wrong — unnecessary client-side fetch for static data
'use client';
useEffect(() => { fetch('/api/data').then(...) }, []);
```

---

## AI/ML

### Embedding cost control — batch, don't loop

```ts
// ✅ Correct — single API call for N items
const embeddings = await openai.embeddings.create({ input: texts, model: 'text-embedding-3-large' });

// ❌ Wrong — N API calls
for (const text of texts) {
  const emb = await openai.embeddings.create({ input: text, ... }); // N roundtrips
}
```
