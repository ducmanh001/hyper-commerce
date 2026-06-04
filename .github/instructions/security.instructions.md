---
applyTo: 'apps/*-service/**/*.ts,libs/**/*.ts'
---

# Security Rules — Always Apply

## Cryptography

- OTP / token / session ID generation → MUST use `crypto`, NEVER `Math.random()`
  ```typescript
  import { randomInt, randomBytes } from 'crypto';
  // OTP
  const otp = randomInt(100_000, 1_000_000).toString();
  // Token / session ID
  const token = randomBytes(32).toString('hex');
  // UUID
  import { v4 as uuid } from 'uuid';
  ```
- Password hashing → `bcrypt` with cost factor ≥ 12, NEVER `md5`/`sha1`/`sha256` for passwords
- JWT secret → env var only, ≥ 32 chars, rotated quarterly

## Input validation (all service boundaries)

- HTTP controllers: `class-validator` DTOs (`@IsString()`, `@IsUUID()`, `@IsInt()` etc.)
- Kafka consumers: `zod` schema validation on message payload
- Raw SQL: NEVER string interpolation → always TypeORM parameterized or `qb.where('col = :val', { val })`

## Authorization

- Every non-public endpoint: `@UseGuards(JwtAuthGuard)` minimum
- Admin-only: add `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Role.ADMIN)`
- Resource ownership check: verify `resource.userId === req.user.id` before mutate
- Admin service: MUST bind `127.0.0.1`, never `0.0.0.0`

## Secrets

- Never in code, never in logs → env vars only
- Log sanitization: never log `password`, `token`, `otp`, `secret`, `card_number`
  ```typescript
  // ❌ NEVER
  this.logger.log(`User login: ${JSON.stringify(dto)}`); // may contain password
  // ✅ OK
  this.logger.log(`User login attempt: userId=${userId}`);
  ```

## Rate limiting

- OTP endpoints: max 3 sends per 10 min per phone → Redis `INCR` + TTL
- Auth endpoints: `@Throttle()` decorator or token-bucket guard from `libs/common`
