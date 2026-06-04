# HyperCommerce — Global Context

> **For detailed domain context, load the relevant agent file. This file stays minimal.**

## Identity

Multi-vendor social commerce platform. Target: 50M DAU, 500K orders/day, 100K concurrent livestreams. Vietnam market (VND currency), Vietnamese + English.

## Tech Stack (quick reference)

| Layer      | Tech                                              |
| ---------- | ------------------------------------------------- |
| Language   | TypeScript 5.x, Node 20                           |
| Backend    | NestJS 10.4 + TypeORM 0.3                         |
| Frontend   | Next.js 14 App Router + Zustand + TanStack Query  |
| Gateway    | Express.js + Socket.IO 4.7                        |
| Primary DB | PostgreSQL 16 (Citus, sharded by user_id)         |
| Cache      | Redis 7.2                                         |
| Events     | Kafka 7.6 (6 partitions, 7d retention)            |
| Search     | Elasticsearch 8.13 (BM25) + Qdrant (768-dim kNN)  |
| Analytics  | ClickHouse 24.3                                   |
| Timelines  | ScyllaDB 5.4 (Cassandra-compatible, fan-out)      |
| Jobs       | BullMQ (Redis-backed)                             |
| AI/ML      | OpenAI GPT-4o / text-embedding-3-large, LangGraph |

## Service → Port Map

```
:3000 web (Next.js)     :3001 user-service    :3002 feed-service
:3003 order-service     :3004 inventory        :3005 search-service
:3006 live-service      :3007 payment          :3008 notification
:3009 analytics         :3010 ai-service       :3011 admin (localhost only)
:3012 ads-service       :3013 subscription     :3015 chat-service
:3016 review-service    :3017 wallet-service   :4000 api-gateway
```

## Architecture Patterns (always apply)

- **Outbox Pattern**: save `OutboxEvent` in same DB transaction → poll → Kafka. NEVER dual-write.
- **Saga Choreography**: `order.created → inventory.reserve → payment.charge → order.confirm` — compensating events on failure
- **3-Tier Stock**: Redis atomic DECR → PG reservation (15min TTL) → PG source of truth
- **Fan-out on Write**: Cassandra timelines for ≤10K followers; pull for celebrities

## Non-negotiable Security Rules

- NEVER store secrets in code — env vars only
- Admin service MUST NOT bind `0.0.0.0` in prod (use `127.0.0.1`)
- All user inputs validated with `class-validator` + `zod` at boundaries
- Kafka topics in prod require SASL/mTLS

## Domain Routing (agents auto-load by active file path)

| Keywords in request                                        | Load agent                  |
| ---------------------------------------------------------- | --------------------------- |
| order, payment, stock, voucher, review, rating             | `agents/commerce.agent.md`  |
| user, auth, feed, live, stream, chat, follow, subscription | `agents/social.agent.md`    |
| notify, analytics, ad, campaign, dashboard, gmv            | `agents/platform.agent.md`  |
| search, vector, recommend, fraud, embedding, ai            | `agents/ai-ml.agent.md`     |
| web, page, component, ui, next.js, ssr                     | `agents/frontend.agent.md`  |
| docker, k8s, migration, prometheus, deploy                 | `agents/infra.agent.md`     |
| lib, shared, kafka producer, redis client, queue           | `agents/backend.agent.md`   |
| architecture, design, new service, sharding, saga          | `agents/architect.agent.md` |
| feature idea, i want, phase 1, explore, plan card          | `agents/discovery.agent.md` |

**Ambiguous task rule**: Nếu task không map rõ vào bất kỳ keyword nào trong bảng trên,
hoặc span > 2 domain, hoặc chứa từ "not sure", "maybe", "explore", "what if" →
bắt buộc load `agents/discovery.agent.md` trước. Không implement thẳng.

## Workflow Files

- **Fragments**: `.github/prompts/fragments/` — +base +kafka +redis +tx +migration +verify-L2/L3/L4 +wrap
- **Specs**: `.github/specs/*.spec.md` — invoke: `@{agent} #file:.github/specs/{name}.spec.md +wrap`
- **Instructions**: `.github/instructions/` — auto-load by `applyTo` (nestjs, nextjs, database, security, testing)
- **Discovery**: `.github/agents/discovery.agent.md` — vague idea → Plan Card | confirmed plan → implement prompt
- **Prompts**: `.github/prompts/` — optional team checklists only, NOT needed for one-off work

> Implement any feature: describe it directly. AI self-retrieves SCHEMA.md → entities → EVENTS.md → events.ts.
> After new table/event: run `make context:refresh` to regenerate all catalogs.

## Context Layers (how context auto-loads)

| Layer     | File(s)                          | Trigger                        | Purpose                                |
| --------- | -------------------------------- | ------------------------------ | -------------------------------------- |
| 1 Root    | `copilot-instructions.md`        | Always                         | Stack, ports, patterns, security       |
| 2 Service | `agents/{domain}.agent.md`       | `applyTo` by service folder    | Domain entities, service rules         |
| 3 Module  | `instructions/*.instructions.md` | `applyTo` by file type/path    | Code conventions, DB rules             |
| 4 Task    | `prompts/*.prompt.md`            | Explicit `/command` (optional) | Team-shared repeatable checklists only |

**Key references** (load on demand — not auto-loaded):

- Kafka events: `libs/events/EVENTS.md` — topic routing + saga diagram (payload → read `events.ts`)
- DB schema: `infrastructure/postgres/SCHEMA.md` — table→service map + migration number (columns → read entity file)
- gRPC catalog: `libs/grpc/PROTOS.md` — 5 services, methods, request/response fields, client pattern
- Queue catalog: `libs/queue/QUEUES.md` — 22 queue names, 29 job names, concurrency, job options

## Self-Retrieval Rules (LCB v3 L5 — never guess, always retrieve)

**Rule**: If you would write "I think...", "probably...", or assume any of the items below → STOP. Read the file first, then answer.

| Unsure about                             | Retrieve BEFORE answering                           | Update AFTER implementing                          |
| ---------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Bắt đầu mọi task                         | Đọc `.github/PATTERNS.md` trước                     | Nếu fix recurring bug → add pattern ngay sau       |
| Table exists? which service owns it?     | `infrastructure/postgres/SCHEMA.md` (table map)     | Create entity file → run `make context:index`      |
| Column names / data types / indexes?     | Read the entity file listed in SCHEMA.md table map  | Edit the entity file — not SCHEMA.md               |
| Next migration number?                   | `infrastructure/postgres/SCHEMA.md` (top of file)   | Run `make context:index` — auto-derived from files |
| Kafka topic exists? which services?      | `libs/events/EVENTS.md` (routing table)             | Add row to routing table in EVENTS.md              |
| Kafka event payload / interface?         | `libs/events/src/events.ts`                         | Add interface to events.ts                         |
| Saga flow / compensating events?         | `libs/events/EVENTS.md` (saga diagram)              | Update diagram if flow changes                     |
| gRPC method name / request type?         | `libs/grpc/PROTOS.md` (catalog)                     | Add new method to proto file + PROTOS.md           |
| Queue name / Job name constant           | `libs/queue/src/constants/queue.constants.ts`       | Add constants to that file                         |
| API Gateway proxy routes                 | `apps/api-gateway/server.js`                        | Add proxy route for new services                   |
| Port number / service name               | Already in this file — reread above                 | Add new service to port map in this file           |
| Business rules (VND, concurrency, tiers) | `infrastructure/postgres/SCHEMA.md` (rules section) | Add rule to SCHEMA.md rules section                |

**Fallback if file is missing or unreadable**: State explicitly _"I cannot find [file] — please provide or create it"_. Never fabricate schema, event names, or port numbers.

## Adaptive Context Loading (LCB v3 L3) — Context Recipes

Read ONLY what the task needs. Check this table BEFORE loading context:

| Task type                           | Files to read                                                 | Skip                     |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------ |
| Bug fix · typo · rename             | File mentioned only                                           | everything else          |
| Add endpoint (no new table/event)   | Service file + entity file                                    | SCHEMA.md, EVENTS.md     |
| New table + migration               | SCHEMA.md → entity path → entity file                         | EVENTS.md                |
| New Kafka topic/event               | EVENTS.md → events.ts                                         | SCHEMA.md                |
| New NestJS service                  | api-gateway/server.js + this file (ports)                     | agent files              |
| Full feature (table + events + API) | SCHEMA.md + EVENTS.md + entity files + events.ts              | —                        |
| Frontend page/component             | That page + hooks + relevant store                            | backend files            |
| Security change (guard/middleware)  | File being changed only (security.instructions.md auto-loads) | SCHEMA.md, EVENTS.md     |
| Infra/deploy (K8s/Docker/CI/Nginx)  | Target infra file only (infra.agent.md auto-loads)            | service files, SCHEMA.md |

**L8 — Context Budget Guard**: If ≥ 8 files already read this session → stop loading more.
Work with what you have, or state: "Need [file X] to proceed — should I read it?" Never silently truncate.

## Multi-step Task Handoff (LCB v3 L4)

For tasks spanning multiple turns or sessions:

1. After each major step → write state to `/memories/session/` (files changed, decisions, what next step needs)
2. At start of continuation session → read that session file first
3. Handoff only what the next step cannot re-derive from code — skip file contents it will read itself

## Learned Patterns (LCB v3 L6 — updated over time)

See `.github/PATTERNS.md` for accumulated patterns from past tasks.
When you fix a recurring bug or find a project-specific anti-pattern → add it there immediately.
