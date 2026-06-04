# HyperCommerce — AI Agent Development Guide

> Hướng dẫn viết prompt, đo chất lượng implement, và benchmark token tiêu thụ.
> Áp dụng cho: GitHub Copilot Agent, Claude, GPT-4o trên VS Code Chat.

---

## Mục lục

1. [Tại sao cần cấu trúc prompt?](#1-tại-sao-cần-cấu-trúc-prompt)
2. [Anatomy của một prompt](#2-anatomy-của-một-prompt)
3. [4 Level prompt từ nhỏ → lớn](#3-4-level-prompt-từ-nhỏ--lớn)
4. [Template chuẩn cho project này](#4-template-chuẩn-cho-project-này)
5. [Task Scorecard — đo chất lượng implement](#5-task-scorecard--đo-chất-lượng-implement)
6. [Benchmark token tiêu thụ](#6-benchmark-token-tiêu-thụ)
7. [Chiến lược giảm token mà không giảm chất lượng](#7-chiến-lược-giảm-token-mà-không-giảm-chất-lượng)
8. [Anti-patterns cần tránh](#8-anti-patterns-cần-tránh)
9. [Ví dụ thực tế từ project này](#9-ví-dụ-thực-tế-từ-project-này)
10. [Prompt Fragments — Kế thừa như hàm](#10-prompt-fragments--kế-thừa-như-hàm)
11. [Không biết HOW — Explore trước, Code sau](#11-không-biết-how--explore-trước-code-sau)
12. [Feature Spec — Tài liệu bền vững thay prompt](#12-feature-spec--tài-liệu-bền-vững-thay-prompt)

---

## 1. Tại sao cần cấu trúc prompt?

| Metric                                  | Vibe Coding | Structured Prompt      |
| --------------------------------------- | ----------- | ---------------------- |
| TypeScript errors sau implement lần đầu | 3–8 errors  | 0 errors               |
| Security issues bị miss                 | ~40%        | ~5%                    |
| Business rule gaps                      | Nhiều       | Ít (checklist enforce) |
| Số rounds cần sửa lại                   | 3–5 rounds  | 1–2 rounds             |
| Token tiêu thụ tổng (vì sửa nhiều lần)  | ~80K tokens | ~25K tokens            |
| Score /10 (Scorecard bên dưới)          | 4–6         | 8–10                   |

> **Insight**: Prompt không có context → agent đoán → sai → bạn fix → agent fix lại = tiêu gấp 3x token so với prompt tốt ngay từ đầu.

---

## 2. Anatomy của một prompt

```
┌─────────────────────────────────────────────────────────┐
│  ROLE          @backend / @ai-ml / @frontend / @infra   │
│                ↓ agent routing tự động load context      │
├─────────────────────────────────────────────────────────┤
│  READ FIRST    file paths agent PHẢI đọc trước khi code  │
│                ↓ ngăn agent đoán schema/pattern          │
├─────────────────────────────────────────────────────────┤
│  CONTEXT       stack + vị trí file + pattern hiện có     │
│                ↓ anchor vào codebase thực tế             │
├─────────────────────────────────────────────────────────┤
│  CONSTRAINTS   business rules + security + non-nego      │
│                ↓ PHẢI đứng trước Tasks                   │
├─────────────────────────────────────────────────────────┤
│  TASKS         danh sách ordered by dependency           │
│                entity → service → controller → kafka     │
├─────────────────────────────────────────────────────────┤
│  SKIP          những thứ KHÔNG làm lần này               │
│                ↓ chặn scope creep + tiết kiệm token      │
├─────────────────────────────────────────────────────────┤
│  VERIFY        lệnh xác nhận sau khi xong                │
│                npx tsc --noEmit hoặc test case cụ thể    │
└─────────────────────────────────────────────────────────┘
```

**Quy tắc bất biến:**

| #   | Quy tắc                | Sai                    | Đúng                                        |
| --- | ---------------------- | ---------------------- | ------------------------------------------- |
| 1   | Role trước             | "Add rate limiting"    | `@backend` Add rate limiting                |
| 2   | File path tuyệt đối    | "in the service"       | `apps/wallet-service/src/wallet.service.ts` |
| 3   | Constraint trước Task  | List tasks → rules     | List rules → tasks                          |
| 4   | Read directive rõ ràng | Assume agent biết      | "Read SCHEMA.md first"                      |
| 5   | Scope có giới hạn      | "Implement everything" | "Only X — skip Y"                           |

---

## 3. 4 Level prompt từ nhỏ → lớn

### Level 1 — Micro (1 hàm / 1 bug fix)

**Khi dùng**: fix lỗi TypeScript, sửa 1 method, rename, typo.
**Token tiêu thụ**: ~500–2K tokens input / ~300–800 output.
**Scorecard bắt buộc**: `Gate 0 only` — compile pass là đủ, không cần báo cáo đầy đủ.

```
[ROLE] [BUG LOCATION] [ERROR MESSAGE] [EXPECTED BEHAVIOR]

Ví dụ:
"Fix TypeScript error in apps/wallet-service/src/wallet.service.ts line 42:
 Argument of type 'string' is not assignable to parameter of type 'number'.
 amount param should be parsed as integer VND."
```

**KHÔNG cần**: Read First, Architecture, Tasks list, Verify, Scorecard report.

---

### Level 2 — Feature (1 method / 1 endpoint)

**Khi dùng**: thêm 1 API endpoint, 1 service method, 1 Kafka consumer.
**Token tiêu thụ**: ~2K–8K input / ~1K–3K output.
**Scorecard bắt buộc**: `Gate 0 + G1 + G2 + G3 (partial)` — báo cáo 3 gates, threshold ≥ 8/10.

```markdown
@{agent} {action} in {file_path}

Context:

- Entity: {table} — {key columns} (read entity file first)
- Pattern to follow: {existing similar method}

Constraints:

- {rule 1 từ domain}
- {rule 2 từ security}

Tasks:

1. {step 1}
2. {step 2}
3. {step 3}

Output: TypeScript only, no explanation.
```

---

### Level 3 — Service (toàn bộ 1 NestJS service)

**Khi dùng**: tạo service mới hoặc complete một service near-empty.
**Token tiêu thụ**: ~8K–25K input / ~5K–15K output.
**Scorecard bắt buộc**: `Gate 0 + G1 + G2 + G3 + G4 + G5` — báo cáo đầy đủ 5 gates, threshold ≥ 14/17.

```markdown
@{agent} Implement {service-name} (port {N}).

Read first:

- infrastructure/postgres/SCHEMA.md ← migration number
- libs/events/EVENTS.md ← kafka routing
- libs/events/src/events.ts ← event interfaces
- apps/{related-service}/src/entities/ ← foreign entities

Architecture:
{service} consumes {upstream events} → {produces events} → {downstream services}

Domain rules:

- {rule 1 — BIGINT VND / atomic Lua / etc}
- {rule 2}

Tasks (ordered by dependency):

1. Entity + migration SQL
2. Repository layer
3. Service business logic
4. Controller + DTOs
5. Kafka consumers
6. Kafka producers (via Outbox if order-service)
7. Module wiring + registration in AppModule

Integration:

- Add proxy route in apps/api-gateway/server.js
- Add row to EVENTS.md routing table
- Update SCHEMA.md table map

Skip: {premature features — tests, gRPC, tracing}

Verify: npx tsc --noEmit
```

---

### Level 4 — Cross-Service Feature (saga / multi-service flow)

**Khi dùng**: tính năng span nhiều service (order flow, gift flow, subscription upgrade).
**Token tiêu thụ**: ~25K–80K input / ~15K–40K output.
**Lưu ý**: Nên dùng subagent hoặc chia thành nhiều session.
**Scorecard bắt buộc**: `Gate 0 + G1 + G2 + G3 + G4 + G5 + G6` — tất cả gates, threshold ≥ 16/20.

```markdown
@architect Implement {feature} spanning {serviceA}, {serviceB}, {serviceC}.

Read first:

- infrastructure/postgres/SCHEMA.md
- libs/events/EVENTS.md
- libs/events/src/events.ts
- apps/{serviceA}/src/entities/
- apps/{serviceB}/src/entities/

Saga flow:
serviceA ──[event.X]──► serviceB ──[event.Y]──► serviceC
◄─[event.FAIL]── on failure

Compensating events:

- event.Y fails → serviceB emits event.ROLLBACK_Y → serviceA releases resource

Tasks per service:

## serviceA

1. ...

## serviceB

1. ...

## serviceC

1. ...

New Kafka events (add to events.ts + EVENTS.md):

- {NewEvent} interface: { eventId, eventType, occurredAt, traceId, version, ...fields }

Migration:

- File: infrastructure/postgres/migrations/{N}\_{description}.sql
- Include -- ROLLBACK: comment

Skip: Frontend, gRPC wiring, ONNX models, admin UI

Verify:

1. npx tsc --noEmit
2. Unit test: happy path + compensation path
```

---

## 4. Template chuẩn cho project này

Dựa trên agent routing trong `.github/copilot-instructions.md`:

```markdown
@{agent} ← chọn từ bảng bên dưới

Read first:

- {file theo Context Recipe trong copilot-instructions.md}

Context:

- Pattern: {follow existing similar implementation}
- Stack: NestJS 10.4 + TypeORM 0.3 + Node 20

Constraints: ← PHẢI có section này

- All VND values: BIGINT (integer dong) — never float
- Kafka publish: via Outbox pattern (order-service) or direct (other services)
- Secrets: env vars only — never hardcode
- Admin service: bind 127.0.0.1 only
- Atomic writes: Lua script (Redis) or QueryRunner (PG)

Tasks:

1. ...

Skip: {anything not in scope}

Verify: npx tsc --noEmit --project tsconfig.json 2>&1 | grep "error TS"
```

**Agent routing nhanh:**

| Task liên quan đến                         | Dùng agent   |
| ------------------------------------------ | ------------ |
| order, payment, inventory, voucher, review | `@commerce`  |
| user, auth, feed, live, chat, subscription | `@social`    |
| notification, analytics, ads, admin        | `@platform`  |
| search, vector, fraud, embedding, AI       | `@ai-ml`     |
| web pages, components, Next.js             | `@frontend`  |
| Docker, K8s, migrations, CI/CD             | `@infra`     |
| libs/common, kafka, redis, queue           | `@backend`   |
| new service, sharding, saga design         | `@architect` |

---

## 5. Task Scorecard — đo chất lượng implement

Chạy checklist này sau mỗi task implement. **Agent PHẢI tự chạy và báo cáo scorecard trước khi kết thúc turn.**

### Gates áp dụng theo Level

| Gate               | Nội dung                  | L1 Micro | L2 Feature | L3 Service | L4 Cross-svc |
| ------------------ | ------------------------- | :------: | :--------: | :--------: | :----------: |
| G0                 | Compile + Lint (binary)   |    ✅    |     ✅     |     ✅     |      ✅      |
| G1                 | Completeness (0–4 pts)    |    —     |     ✅     |     ✅     |      ✅      |
| G2                 | Security (0–3 pts)        |    —     |     ✅     |     ✅     |      ✅      |
| G3                 | Architecture (0–4 pts)    |    —     |  partial¹  |     ✅     |      ✅      |
| G4                 | Runtime Safety (0–3 pts)  |    —     |     —      |     ✅     |      ✅      |
| G5                 | Event Integrity (0–3 pts) |    —     |     —      |     ✅     |      ✅      |
| G6                 | Observability (0–3 pts)   |    —     |     —      |     —      |      ✅      |
| **Max score**      |                           | G0 only  |  **/10**   |  **/17**   |   **/20**    |
| **Pass threshold** |                           |   PASS   |  **≥ 8**   |  **≥ 14**  |   **≥ 16**   |

> ¹ L2 partial G3: chỉ check Outbox + TTL (2 items), bỏ qua 2 items còn lại.

**Verify directive thêm vào cuối prompt theo level:**

```markdown
# L1: không cần

# L2:

Verify: npx tsc --noEmit
Report scorecard: G0 + G1 + G2 + G3 (outbox + TTL only). Threshold ≥ 8/10.

# L3:

Verify: npx tsc --noEmit && npm run lint:check
Report full scorecard G0–G5. Threshold ≥ 14/17.

# L4:

Verify: npx tsc --noEmit && npm run lint:check
Report full scorecard G0–G6. Threshold ≥ 16/20.
Do NOT end response without posting the scorecard table.
```

---

### Scorecard template đầy đủ (L3 / L4)

```markdown
## Task Scorecard — {Service / Feature Name}

Date: {YYYY-MM-DD}
Agent: {backend/ai-ml/frontend} | Level: {1/2/3/4} | Applied gates: {G0 / G0-G3 / G0-G5 / G0-G6}

---

### Gate 0 — Compile + Lint (binary — FAIL = block merge, không tính điểm)

- [ ] `npx tsc --noEmit` = 0 errors PASS / FAIL
- [ ] `npm run lint:check` passes PASS / FAIL
- [ ] `npm run format:check` passes PASS / FAIL

> Nếu bất kỳ Gate 0 nào FAIL → dừng, fix ngay, không chạy gates tiếp theo.

---

### Gate 1 — Completeness (0–4 pts)

- [ ] Tất cả items trong task list đều có code (+1)
- [ ] Edge cases từ domain rules được handle (+1)
      Ví dụ: balance < 0 | stock = 0 | duplicate idempotency key
- [ ] Error cases throw đúng exception + HTTP status code (+1)
      409 conflict | 404 not found | 422 unprocessable
- [ ] Redis/Kafka key names khớp pattern trong SCHEMA.md (+1)

### Gate 2 — Security (0–3 pts)

- [ ] Không có hardcoded secret, URL, credential, API key (+1)
- [ ] Input validation tại boundary: class-validator DTO (+1)
      @IsUUID | @IsInt | @IsNotEmpty | @Min(0) khi cần
- [ ] Idempotency key hoặc distributed lock cho mọi write op (+1)
      order:lock:{key} | wallet:rl:{userId} | Redis NX SET

### Gate 3 — Architecture (0–4 pts)

- [ ] Kafka publish qua Outbox (wallet/order-service) (+1)
      HOẶC direct kafka.publish() với đúng pattern (services khác)
- [ ] Multi-table write dùng QueryRunner transaction (+1)
      Không có 2 `await repo.save()` riêng lẻ không trong cùng tx
- [ ] Redis TTL có mặt trên TẤT CẢ cache keys (+1)
      Không có `redis.set(key, val)` thiếu `'EX', N`
- [ ] Không dual-write: không `await kafka.emit()` + `await repo.save()` (+1)
      trong cùng try block mà không qua Outbox

### Gate 4 — Runtime Safety (0–3 pts) ← common missed

- [ ] Provider/Service được khai báo trong module providers[] (+1)
      Import + add vào @Module({ providers: [...], exports: [...] })
- [ ] @EventPattern / @MessagePattern topic name (+1)
      khớp CHÍNH XÁC với string trong EVENTS.md routing table
- [ ] Env vars được đọc qua process.env.VAR_NAME (+1)
      Có fallback guard hoặc documented trong .env.example

### Gate 5 — Event Integrity (0–3 pts) ← chỉ áp dụng nếu có Kafka

- [ ] Interface mới được thêm vào libs/events/src/events.ts (+1)
- [ ] Row mới được thêm vào libs/events/EVENTS.md routing table (+1)
- [ ] Event payload có đủ 5 trường bắt buộc: (+1)
      eventId | eventType | occurredAt | traceId | version

### Gate 6 — Observability (0–3 pts) ← thường bị bỏ qua

- [ ] Không có `console.log` — dùng `new Logger(ClassName)` (+1)
      private readonly logger = new Logger(WalletService.name)
- [ ] Không có silent catch: `catch(e) {}` hoặc `catch(e) { return }` (+1)
      Luôn log.error(e) + rethrow hoặc emit dead-letter event
- [ ] Kafka consumer có error handler → dead letter hoặc retry (+1)
      @OnEvent error → this.logger.error + re-queue hoặc DLQ

---

Total: \_\_\_/20

Pass threshold : ≥ 16/20
Không merge nếu: bất kỳ Gate 0 FAIL | Gate 2 Security < 2 | Gate 3 < 3

Rounds to merge: \_\_\_ ← track số lần phải sửa sau implement lần đầu
```

**Ý nghĩa score:**

| Score | Ý nghĩa    | Action                                                   |
| ----- | ---------- | -------------------------------------------------------- |
| 20/20 | Perfect    | Merge ngay                                               |
| 18–19 | Tốt        | Merge sau 1 fix nhỏ                                      |
| 16–17 | Đạt        | Review lại 1 gate cụ thể rồi merge                       |
| 13–15 | Trung bình | Follow-up prompt targeted vào gate bị thiếu              |
| < 13  | Kém        | Re-implement với prompt Level cao hơn + thêm Constraints |

**Cách dùng với agent — thêm vào cuối mọi prompt Level 2+:**

```markdown
After implementing, self-evaluate using the Task Scorecard:
Run: npx tsc --noEmit && npm run lint:check
Then report score for each gate (G1–G6) before finishing.
Do NOT end the response without posting the scorecard.
```

---

## 6. Benchmark token tiêu thụ

> Đo trên Claude Sonnet 4.5 / GPT-4o với codebase HyperCommerce.
> Token = input (prompt + context files) + output (generated code).
> `1K tokens ≈ 750 từ tiếng Anh ≈ 600 từ tiếng Việt ≈ ~40 dòng code TypeScript`

### Theo Prompt Level

| Level            | Task ví dụ               | Input tokens | Output tokens | Total | Rounds avg | Total thực tế |
| ---------------- | ------------------------ | ------------ | ------------- | ----- | ---------- | ------------- |
| L1 Micro         | Fix 1 TypeScript error   | 500–1K       | 200–500       | ~1.5K | 1.0        | ~1.5K         |
| L2 Feature       | Add 1 API endpoint       | 2K–5K        | 1K–2K         | ~6K   | 1.2        | ~7K           |
| L3 Service       | Implement wallet-service | 10K–20K      | 8K–15K        | ~28K  | 1.5        | ~42K          |
| L4 Cross-service | Order saga full flow     | 30K–60K      | 20K–40K       | ~80K  | 2.0        | ~160K         |

### Theo loại context load

| Context loaded                    | Token cost | Có nên load?                    |
| --------------------------------- | ---------- | ------------------------------- |
| Chỉ file đang sửa                 | ~500–2K    | ✅ Luôn luôn                    |
| Entity file liên quan             | ~500–1K    | ✅ Khi cần schema               |
| SCHEMA.md (chỉ index)             | ~1.5K      | ✅ Khi cần migration number     |
| EVENTS.md (chỉ routing)           | ~1K        | ✅ Khi thêm Kafka event         |
| events.ts (full interfaces)       | ~3K        | ✅ Khi cần event type           |
| Toàn bộ agent file (\*.agent.md)  | ~2K–5K     | ✅ Auto-load theo applyTo       |
| Tất cả entity files của 1 service | ~3K–8K     | ⚠️ Chỉ khi cần cross-entity     |
| copilot-instructions.md full      | ~4K        | ✅ Auto-load (luôn có)          |
| Toàn bộ service src/              | ~15K–40K   | ❌ Tránh — dùng search thay thế |
| node_modules (nếu leak)           | ~100K+     | ❌ Luôn exclude                 |

### Benchmark theo task thực tế trong project này

| Task                              | Vibe (không có cấu trúc) | Structured Prompt | Tiết kiệm |
| --------------------------------- | ------------------------ | ----------------- | --------- |
| Implement WalletService.debit()   | ~15K (3 rounds)          | ~6K (1 round)     | 60%       |
| Create wallet-service từ đầu      | ~120K (4 rounds)         | ~45K (1.5 rounds) | 63%       |
| Fix Kafka publish pattern         | ~8K (2 rounds)           | ~2K (1 round)     | 75%       |
| Add feed ranking algorithm        | ~50K (3 rounds)          | ~20K (1.5 rounds) | 60%       |
| Implement fraud detection L1      | ~40K (3 rounds)          | ~18K (1.5 rounds) | 55%       |
| Wire TracingModule vào 9 services | ~20K (2 rounds)          | ~8K (1 round)     | 60%       |

### Token cost ước tính theo pricing (GPT-4o, June 2026)

```
GPT-4o:    input $2.50/1M tokens | output $10.00/1M tokens
Claude S4: input $3.00/1M tokens | output $15.00/1M tokens

Task ví dụ: wallet-service full implement
  Vibe:       120K tokens total → ~$0.72
  Structured:  45K tokens total → ~$0.27
  Tiết kiệm:  $0.45 per task

Với 50 tasks/sprint:
  Vibe:       ~$36/sprint
  Structured: ~$13.50/sprint
  Tiết kiệm:  ~$22.50/sprint (~63%)
```

---

## 7. Chiến lược giảm token mà không giảm chất lượng

### 7.1 Context Budget Rule (từ copilot-instructions.md L8)

```
Nếu đã đọc ≥ 8 files trong 1 session → DỪNG load thêm.
Làm việc với những gì đã có, hoặc nói rõ: "Need [file X] to proceed".
```

### 7.2 Context Recipe — chỉ load những gì task cần

| Task type                        | Load                                         | Bỏ qua               |
| -------------------------------- | -------------------------------------------- | -------------------- |
| Bug fix / rename                 | Chỉ file đang sửa                            | Tất cả còn lại       |
| Add endpoint (không có bảng mới) | Service file + entity file                   | SCHEMA.md, EVENTS.md |
| Bảng mới + migration             | SCHEMA.md → entity file                      | EVENTS.md            |
| Kafka topic/event mới            | EVENTS.md → events.ts                        | SCHEMA.md            |
| Service mới                      | api-gateway/server.js + ports                | Agent files          |
| Full feature                     | SCHEMA.md + EVENTS.md + entities + events.ts | —                    |
| Frontend page/component          | Page file + hooks + store                    | Backend files        |

### 7.3 Skip section trong prompt

```markdown
Skip:

- LambdaMART GBDT (v1 linear đủ cho MVP)
- GNN Node2Vec fraud L3 (over-engineered)
- Unit tests (separate task)
- gRPC wiring (separate task)
- Frontend (separate task)
```

> Mỗi item trong Skip = 1 feature agent sẽ KHÔNG generate → tiết kiệm ~20% output tokens.

### 7.4 Output directive

```markdown
Output: TypeScript code only, no explanation, no comments on unchanged code.
```

> Không có directive này → agent generate explanation, comments, doc strings → +30–50% output tokens vô ích.

### 7.5 Chia session thay vì 1 prompt khổng lồ

```
Thay vì: 1 prompt cho toàn bộ Order Saga (~160K tokens, 2 rounds)
Chia ra:
  Session 1: order-service entities + outbox     → ~20K tokens
  Session 2: inventory-service kafka consumer    → ~15K tokens
  Session 3: payment-service saga + rollback     → ~18K tokens
  Session 4: integration + api-gateway routes    → ~10K tokens
  Tổng: ~63K tokens (vs 160K) = tiết kiệm 61%
```

---

## 8. Anti-patterns cần tránh

### ❌ Context Dump — paste toàn bộ file vào prompt

```markdown
# SAI

Đây là toàn bộ order.service.ts (400 dòng):
[paste file]
Fix lỗi cho tôi.

# ĐÚNG

File: apps/order-service/src/order.service.ts line 87
Error: Cannot read properties of undefined (reading 'userId')
Context: createOrder() method, qr.manager.save() call
```

### ❌ Vague constraint — constraint không đo được

```markdown
# SAI

"Make sure it's secure"
"Handle errors properly"

# ĐÚNG

"All user inputs validated with class-validator at DTO boundary"
"Webhook endpoints MUST call strategy.verifyWebhook() before processing"
```

### ❌ Task không có thứ tự dependency

```markdown
# SAI

Tasks:

- Add Kafka consumer
- Create entity
- Add migration

# ĐÚNG

Tasks (ordered by dependency):

1. Create entity (apps/wallet-service/src/entities/wallet-transaction.entity.ts)
2. Create migration (infrastructure/postgres/migrations/5_wallet.sql)
3. Service business logic (wallet.service.ts)
4. Add Kafka consumer (consumes order.events)
```

### ❌ Không có Verify step

```
Không có verify → agent không biết "done" nghĩa là gì
→ generate thêm code không cần thiết để "chắc chắn"
→ +20–40% output tokens vô ích
```

### ❌ Không có Skip section → Scope Creep

```
Không skip → agent tự thêm: tests, swagger docs, logging,
              admin endpoints, migration, frontend components...
→ +50–200% output tokens, hầu hết là code bạn không cần lúc này
```

---

## 9. Ví dụ thực tế từ project này

### Ví dụ 1: L2 — Add WalletService.debit()

```markdown
@backend Add debit() method to wallet-service.

Read first: apps/wallet-service/src/entities/wallet-transaction.entity.ts

Constraints:

- All VND values BIGINT — never float/decimal
- SELECT ... FOR UPDATE on latest tx row before every debit
- Rollback entire transaction if balance < amount
- Throw InsufficientBalanceException (HTTP 409)

Tasks:

1. Add debit(userId: string, amount: bigint, refId: string): Promise<WalletTransaction>
2. Use QueryRunner — lock latest tx row → check balance → insert new tx row
3. balanceAfter = previousBalanceAfter - amount

Skip: unit tests, topup(), controller endpoint
Output: TypeScript only, no explanation.
Verify: npx tsc --noEmit
```

**Token cost**: ~4K input + ~1.5K output = **5.5K total, 1 round**

---

### Ví dụ 2: L3 — Complete subscription-service

```markdown
@social Complete subscription-service (port 3013, near-empty).

Read first:

- apps/subscription-service/src/entities/subscription-plan.entity.ts
- apps/subscription-service/src/entities/seller-subscription.entity.ts
- infrastructure/postgres/SCHEMA.md (migration number)

Architecture:
user-service tiered JWT → subscription-service stores plan → BullMQ renewal cron

Domain rules:

- Tiers: FREE | BASIC | PRO | ENTERPRISE
- On expiry: revert to FREE → invalidate Redis session → seller must re-login
- Commission rates: FREE=3% | BASIC=2.5% | PRO=2% | ENTERPRISE=1.5%

Tasks:

1. SubscriptionService.upgrade(sellerId, planId) — validate, create seller_subscription row
2. SubscriptionService.downgradeExpired() — cron every day, find expiring subscriptions
3. BullMQ job: subscription.renewal in libs/queue/src/constants/queue.constants.ts
4. REST: GET /subscriptions/plans, POST /subscriptions/upgrade, GET /subscriptions/me
5. Emit user.events.seller_tier_changed on upgrade/downgrade

Skip: payment charge (assume pre-paid), frontend, admin UI
Output: TypeScript only.
Verify: npx tsc --noEmit
```

**Token cost**: ~12K input + ~6K output = **18K total, 1.5 rounds avg**

---

### Ví dụ 3: L1 — Fix Redis TTL bị thiếu

```markdown
Fix missing Redis TTL in apps/inventory-service/src/flash-sale/flash-sale.service.ts

Line ~67: redis.set(`flash:user:bought:${saleItemId}:${userId}`, '1')
Missing TTL=86400 (24h) — see SCHEMA.md Redis key patterns

Fix: add TTL argument. Pattern from existing code: redis.set(key, value, 'EX', 86400)
Output: one-line fix only.
```

**Token cost**: ~800 input + ~200 output = **1K total, 1 round**

---

## Tóm tắt nhanh

```
Prompt tốt = Role + Read First + Constraints trước Tasks + Skip + Verify

L1: 1 bug/1 hàm      → ~1.5K tokens
L2: 1 endpoint        → ~7K tokens
L3: 1 service         → ~28–45K tokens
L4: cross-service     → ~80–160K tokens (chia session)

Score target: ≥ 8/10 (Compile + Completeness + Security + Architecture)
Rounds target: ≤ 1.5 trung bình

Tiết kiệm token: Output directive + Skip section + Context Recipe = ~60% vs vibe coding
```

---

## 10. Prompt Fragments — Kế thừa như hàm

**Vấn đề**: Mỗi prompt L2+ lặp lại cùng 1 đoạn constraints, verify, kafka rules → tốn token viết + token đọc.

**Giải pháp**: Định nghĩa 1 lần trong fragment file → gọi bằng `+tag` → agent tự đọc và áp dụng.

```
Không có fragments:            Có fragments:
──────────────────             ─────────────
@backend Add debit()           @backend Add debit()
                               Read: wallet-transaction.entity.ts
Constraints:                   Tasks:
- BIGINT VND never float       1. SELECT FOR UPDATE → check balance → insert
- env vars only                2. Throw InsufficientBalanceException if < 0
- class-validator at boundary
- no dual-write                +base +tx +verify-L2
- atomic QueryRunner
- SELECT FOR UPDATE
- TTL on all Redis keys        ← 5 dòng vs 15+ dòng
Tasks:                         ← ~60% ngắn hơn, cùng output chất lượng
1. ...
Verify: npx tsc --noEmit
Report scorecard G0+G1+G2+G3...
```

---

### Fragment files hiện có

| Tag          | File                                      | Kế thừa khi nào                                          |
| ------------ | ----------------------------------------- | -------------------------------------------------------- |
| `+base`      | `.github/prompts/fragments/+base.md`      | **Luôn luôn** với L2+                                    |
| `+kafka`     | `.github/prompts/fragments/+kafka.md`     | Prompt đề cập Kafka / event / consumer / producer        |
| `+redis`     | `.github/prompts/fragments/+redis.md`     | Prompt đề cập Redis / cache / TTL / lock                 |
| `+tx`        | `.github/prompts/fragments/+tx.md`        | Prompt đề cập transaction / debit / credit / multi-table |
| `+migration` | `.github/prompts/fragments/+migration.md` | Prompt đề cập table mới / migration / entity mới         |
| `+verify-L2` | `.github/prompts/fragments/+verify-L2.md` | Level 2 prompt                                           |
| `+verify-L3` | `.github/prompts/fragments/+verify-L3.md` | Level 3 prompt                                           |
| `+verify-L4` | `.github/prompts/fragments/+verify-L4.md` | Level 4 prompt                                           |

**Auto-include**: Agent tự resolve fragment khi điều kiện match — không cần viết `+tag` rõ ràng.
**Override rule**: `+tag` viết tường minh trong prompt LUÔN override auto-include.

---

### Cách gọi fragment trong prompt

**Cách 1 — Shorthand `+tag`** (ngắn nhất, agent tự đọc file):

```
@backend Add debit() to wallet.service.ts
Read: apps/wallet-service/src/entities/wallet-transaction.entity.ts

Tasks:
1. SELECT FOR UPDATE → check balance → insert tx row
2. Throw InsufficientBalanceException (HTTP 409) if balance < amount

+base +tx +verify-L2
```

**Cách 2 — VS Code `#file:` include** (explicit, guaranteed load):

```
@backend Add debit() to wallet.service.ts
Read: apps/wallet-service/src/entities/wallet-transaction.entity.ts

Tasks:
1. SELECT FOR UPDATE → check balance → insert tx row
2. Throw InsufficientBalanceException (HTTP 409) if balance < amount

#file:.github/prompts/fragments/+base.md
#file:.github/prompts/fragments/+tx.md
#file:.github/prompts/fragments/+verify-L2.md
```

> Cách 2 dùng khi agent không tự resolve được (model yếu hơn, context nhỏ).

---

### Inheritance matrix — fragment nào cho level nào

```
L1  Micro        →  (không cần fragment)
L2  Feature      →  +base  +verify-L2  [+kafka] [+redis] [+tx]
L3  Service      →  +base  +kafka  +redis  +tx  +migration  +verify-L3
L4  Cross-svc    →  +base  +kafka  +redis  +tx  +migration  +verify-L4
```

`[]` = thêm nếu task liên quan | không có ngoặc = luôn luôn.

---

### Before/After token so sánh với fragments

| Prompt          | Không có fragments | Có fragments | Tiết kiệm |
| --------------- | ------------------ | ------------ | --------- |
| L2 Add endpoint | ~3.5K input        | ~1.8K input  | **49%**   |
| L3 New service  | ~18K input         | ~9K input    | **50%**   |
| L4 Saga flow    | ~55K input         | ~28K input   | **49%**   |

> Fragments tiết kiệm ~50% input tokens vì loại bỏ phần lặp lại.
> Output tokens không đổi — chất lượng code như nhau.

---

### Tạo fragment mới

Khi phát hiện 1 đoạn constraints/rules lặp lại ≥ 3 lần trong các prompts:

```bash
# 1. Tạo file
touch .github/prompts/fragments/+{name}.md

# 2. Viết nội dung — ngắn gọn, chỉ rules, không giải thích
# 3. Thêm vào bảng Fragment files ở trên
# 4. Thêm auto-include rule vào copilot-instructions.md
```

Fragment file format chuẩn:

```
{Topic} rules (apply when {condition}):
- Rule 1 — actionable, không cần giải thích tại sao
- Rule 2
- Rule 3
```

---

## 11. Không biết HOW — Explore trước, Code sau

> Áp dụng khi: chỉ biết muốn tính năng gì, chưa có code, không biết nên sửa file nào.

### Tại sao prompt ít thông tin vẫn có thể dùng được

```
❌ Prompt mù:   "Build notification system"
   → Agent đoán stack, đoán schema, đoán pattern
   → Generate sai 60–70% → sửa nhiều rounds → tốn 3–5x token

✅ Explore-first: "Propose plan for notification system — no code yet"
   → Agent đọc codebase thực → plan chính xác
   → Bạn confirm 1 câu → implement 1 shot
```

---

### 2-Phase Pattern

#### Phase 1 — Explore & Plan (bạn viết ít nhất)

```
@architect I want [tên tính năng — 1 câu mô tả].

Phase 1 only — do NOT write code yet.
Explore codebase and propose:
1. Services / files affected
2. New tables / entities needed
3. Kafka events required
4. Implementation level: L2 / L3 / L4
5. Fragments needed: +base +kafka +redis ...
6. Blockers or missing context

Read SCHEMA.md and EVENTS.md before proposing.
```

#### Phase 2 — Confirm → Implement (sau khi xem plan)

```
[Looks good] hoặc [thêm ràng buộc nhỏ: "cap reward at 100 uses"].
Proceed with the plan.

+base +[fragments từ plan] +verify-L{N}
```

---

### Ví dụ — "tôi muốn referral system" (không có code nào)

**Phase 1 — bạn gõ:**

```
@architect I want a referral/invite system for users.
Phase 1 only — propose plan, no code.
Read SCHEMA.md and EVENTS.md before proposing.
```

**Agent trả về:**

```
Proposed plan:
- New table: referrals (referrerId, refereeId, status, rewardAmount BIGINT)
- Redis: referral:code:{code} TTL=365d (đã có pattern trong SCHEMA.md)
- Kafka: thêm field referralCode vào user.registered event
- Wallet: credit 50K VND cashback khi referee đặt đơn đầu tiên
- Level: L3 (new table + kafka + wallet credit)
- Fragments: +base +kafka +tx +migration +verify-L3
- Blocker: wallet-service debit/credit phải xong trước
```

**Phase 2 — bạn confirm:**

```
Good. Cap referral reward at 100 uses per referrer.
Proceed.

+base +kafka +tx +migration +verify-L3
```

→ Agent implement đúng ngay lần đầu vì nó tự đọc codebase thực, không đoán.

---

### Khi nào dùng Phase 1 vs thẳng vào Phase 2

| Tình huống                                      | Dùng                              |
| ----------------------------------------------- | --------------------------------- |
| Không biết HOW + tính năng hoàn toàn mới        | Phase 1 → Phase 2                 |
| Biết cần sửa file nào, không biết chi tiết code | Thêm `Read: {file}` vào L2 prompt |
| Biết HOW + có code mẫu tương tự trong codebase  | Thẳng L2/L3 prompt + fragments    |
| Bug fix / typo / rename                         | L1 thẳng luôn                     |

**Rule 1 câu:**

> Không biết HOW → `@architect` Phase 1.
> Biết HOW nhưng không biết chi tiết → `Read: {file}` trong prompt.
> Biết rõ → implement thẳng với `+fragments`.

---

### Token cost của 2-Phase vs Vibe

| Approach                           | Token tiêu thụ          | Rounds | Chất lượng |
| ---------------------------------- | ----------------------- | ------ | ---------- |
| Vibe (gõ tính năng, không context) | ~80K (3–5 rounds sửa)   | 3–5    | 4–6/20     |
| 2-Phase (explore → implement)      | ~35K (P1: 8K + P2: 27K) | 1.5    | 16+/20     |
| L3 direct (biết HOW + fragments)   | ~18K (1–1.5 rounds)     | 1–1.5  | 16+/20     |

> 2-Phase tốn nhiều hơn L3 direct ~2x — nhưng dùng khi bạn chưa có đủ context để viết L3 direct.

---

## 12. Feature Spec — Tài liệu bền vững thay prompt

> **Vấn đề với prompt thuần**: mỗi session phải viết lại — context mất, mô tả task trôi theo chat history.  
> **Giải pháp**: Viết spec 1 lần, lưu trong `.github/specs/`, agent đọc spec thay vì inline prompt.

---

### Spec vs Prompt — khi nào dùng cái nào

|             | Prompt inline          | Feature Spec                          |
| ----------- | ---------------------- | ------------------------------------- |
| Dùng khi    | L1 bug fix, 1-off task | L2+ feature, team task, multi-session |
| Lưu ở đâu   | Chỉ trong chat         | `.github/specs/{name}.spec.md`        |
| Tái sử dụng | ❌ mất sau session     | ✅ persist, ref lại bất cứ lúc nào    |
| Review được | ❌ khó                 | ✅ PR review, team đọc                |
| Token       | Paste mỗi lần          | 1 `#file:` reference                  |

---

### Cấu trúc spec — mandatory vs optional theo level

```
YAML frontmatter (luôn bắt buộc):
  feature, domain, level, status, created

Section           | L1 | L2 | L3 | L4
──────────────────|────|────|────|────
Goal              | ─  | ✅ | ✅ | ✅   ← 1 câu business value
Read First        | ─  | ✅ | ✅ | ✅   ← files agent đọc trước
Acceptance Criteria│ ─  | ✅ | ✅ | ✅   ← observable behavior, not impl
Domain Rules      | ─  | ─  | ✅ | ✅   ← project-specific rules
Tasks             | ─  | ✅ | ✅ | ✅   ← ordered by dependency
Kafka Events      | ─  | ─  | if | ✅   ← interface + EVENTS.md row
Migration         | ─  | ─  | if | ✅   ← SQL + rollback comment
Edge Cases        | ─  | ─  | ✅ | ✅   ← L3+ recommended
Skip              | ─  | ✅ | ✅ | ✅   ← scope control MANDATORY
Fragments         | ─  | ✅ | ✅ | ✅   ← +base +kafka... +verify-LN
```

`if` = thêm nếu task có Kafka/migration. `─` = không cần.

---

### Cách invoke spec thay prompt

```
# Thay vì paste prompt dài:
@{agent} Implement referral system. [500 từ context...]

# Dùng spec:
@architect #file:.github/specs/referral-system.spec.md
+wrap
```

`+wrap` = agent tự in **header trước khi code** + **scorecard sau khi code**.

---

### Output wrapping — bọc đầu bọc đít (`+wrap`)

Fragment: `.github/prompts/fragments/+wrap.md`

**HEADER** (agent print trước khi viết bất kỳ dòng code nào):

```
## 🔧 Implementation — {feature}
Spec: .github/specs/{filename}.spec.md
Agent: @{domain}  |  Level: L{N}  |  Date: {today}

Reading: [list files being read]
Will touch: [list files to create/modify]
New artifacts: [entities / events / migrations]
Fragments resolved: [+base +kafka ...]
```

**FOOTER** (agent print sau tất cả code):

```
## ✅ Scorecard — {feature}
| Gate               | Score  |
|--------------------|--------|
| G0 Compile+Lint    | PASS   |
| G1 Completeness    | 4/4    |
| G2 Security        | 3/3    |
| G3 Architecture    | 4/4    |
| G4 Runtime Safety  | 3/3    |
| G5 Event Integrity | 3/3    |
| G6 Observability   | 3/3    |
Total: 20/20  |  PASS ✅
```

> Không có `+wrap` → agent có thể bỏ qua header/footer.  
> Luôn thêm `+wrap` vào spec invoke từ L2 trở lên.

---

### Spec lifecycle

```
1. @discovery Phase 1 → Plan Card
2. Confirm plan → @discovery Phase 2 → generates spec file
3. Save to .github/specs/{feature}.spec.md
4. Invoke: @{agent} #file:.github/specs/{feature}.spec.md +wrap
5. After implement: update spec status = DONE
6. Future ref: link spec in PR description
```

---

### Ví dụ invoke thực tế

**L2 — Add rate limiting (biết file rõ):**

```
@backend #file:.github/specs/rate-limiting.spec.md +wrap
```

**L3 — Complete subscription-service:**

```
@social #file:.github/specs/subscription-complete.spec.md +wrap
```

**L4 — Referral system (cross-service saga):**

```
@architect #file:.github/specs/referral-system.spec.md +wrap
```

---

### Context health check — cái gì persistent, cái gì snapshot

| File                             | Type           | Thay đổi khi nào              | Nguy cơ drift                   |
| -------------------------------- | -------------- | ----------------------------- | ------------------------------- |
| `copilot-instructions.md`        | **Persistent** | Deliberate update only        | Thấp                            |
| `agents/*.agent.md`              | **Persistent** | New domain rules              | Thấp                            |
| `instructions/*.instructions.md` | **Persistent** | Convention change             | Thấp                            |
| `prompts/fragments/+*.md`        | **Persistent** | Rule change                   | Thấp                            |
| `SCHEMA.md`                      | **Live index** | Auto via `make context:index` | **Medium** — đọc on-demand      |
| `EVENTS.md`                      | **Live index** | Manual update khi add event   | **Medium** — đọc on-demand      |
| `specs/*.spec.md`                | **Persistent** | Update khi scope thay đổi     | Thấp                            |
| `/memories/repo/*.md`            | **Persistent** | Session discoveries           | Thấp                            |
| `/memories/session/`             | **Ephemeral**  | Cleared per session           | N/A                             |
| Chat history                     | **Ephemeral**  | Gone after session            | ⚠️ HIGH — KHÔNG lưu context đây |

**Rule**: Bất kỳ context nào bạn cần lại sau 1 tuần → phải là file, không phải chat.

---

_Cập nhật lần cuối: 2026-06-05_
_Maintainer: xem `.github/copilot-instructions.md` → Self-Retrieval Rules_
