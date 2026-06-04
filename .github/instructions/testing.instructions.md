---
applyTo: 'apps/**/*.spec.ts,apps/**/*.e2e-spec.ts,apps/**/*.test.ts'
---

# Testing Conventions

## NestJS unit test (Vitest / Jest)

```typescript
// apps/{service}/src/{name}.service.spec.ts
describe('OrderService', () => {
  let service: OrderService;
  let repo: jest.Mocked<OrderRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: OrderRepository, useValue: { findById: jest.fn(), save: jest.fn() } },
        { provide: KafkaProducerService, useValue: { send: jest.fn() } },
        { provide: RedisClientService, useValue: { decr: jest.fn() } },
      ],
    }).compile();
    service = module.get(OrderService);
    repo = module.get(OrderRepository);
  });
```

## What to test per layer

| Layer            | Test type   | Mock                      |
| ---------------- | ----------- | ------------------------- |
| Controller       | Unit        | Mock service              |
| Service          | Unit        | Mock repo + Redis + Kafka |
| Repository       | Integration | Real DB (testcontainers)  |
| BullMQ Processor | Unit        | Mock service methods      |
| Kafka Consumer   | Unit        | Mock handler methods      |

## E2E test pattern

```typescript
// apps/{service}/src/app.e2e-spec.ts
describe('POST /orders', () => {
  it('creates order and publishes outbox event', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${testJwt}`)
      .send({ productId: 'uuid', quantity: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending' });
  });
});
```

## Coverage minimums

- Services: ≥ 80% line coverage
- Critical paths (payment, order create, OTP verify): 100% branch coverage
- Fraud/security guards: always test the DENIED path explicitly

## DO NOT mock

- `crypto` module — use real crypto in tests
- Date/time in business logic — use `jest.useFakeTimers()` instead of fixed strings
