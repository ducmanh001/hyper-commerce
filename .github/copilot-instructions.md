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
:3016 review-service    :4000 api-gateway
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

## Workflow Files

```
.github/prompts/        ← slash commands: /add-feature /refactor /delete-feature /migrate-service
.github/chatmodes/      ← custom chat modes: feature-dev, code-review, debug
.github/instructions/   ← code-gen hints (auto-load by applyTo: nestjs, nextjs, database)
```

## Context Layers (how context auto-loads)

| Layer     | File(s)                          | Trigger                     | Purpose                          |
| --------- | -------------------------------- | --------------------------- | -------------------------------- |
| 1 Root    | `copilot-instructions.md`        | Always                      | Stack, ports, patterns, security |
| 2 Service | `agents/{domain}.agent.md`       | `applyTo` by service folder | Domain entities, service rules   |
| 3 Module  | `instructions/*.instructions.md` | `applyTo` by file type/path | Code conventions, DB rules       |
| 4 Task    | `prompts/*.prompt.md`            | Explicit `/command`         | Spec + step-by-step checklist    |

**Key references** (load on demand — not auto-loaded):

- Kafka events: `libs/events/EVENTS.md` — all 20 topics, saga flow
- DB schema: `infrastructure/postgres/SCHEMA.md` — all 25 tables, next migration number

## Self-Retrieval Rules (LCB v3 L5 — never guess, always retrieve)

**Rule**: If you would write "I think...", "probably...", or assume any of the items below → STOP. Read the file first, then answer.

| Unsure about                             | Retrieve this BEFORE answering                       |
| ---------------------------------------- | ---------------------------------------------------- |
| Table exists? column name? data type?    | `infrastructure/postgres/SCHEMA.md`                  |
| Next migration number?                   | `infrastructure/postgres/SCHEMA.md` (bottom of file) |
| Kafka topic exists? event payload shape? | `libs/events/EVENTS.md`                              |
| Saga flow? compensating events?          | `libs/events/EVENTS.md`                              |
| Entity fields / relations in a service   | `grep_search` the entity file in that service        |
| Queue name / Job name constant           | `libs/queue/src/constants/queue.constants.ts`        |
| API Gateway proxy routes                 | `apps/api-gateway/server.js`                         |
| Port number / service name               | Already in this file — reread above                  |

**Fallback if file is missing or unreadable**: State explicitly _"I cannot find [file] — please provide or create it"_. Never fabricate schema, event names, or port numbers.

## Adaptive Context Loading (LCB v3 L3)

Classify task BEFORE loading extra context — load only what's needed:

| Complexity  | Signal                                       | Context to use                           |
| ----------- | -------------------------------------------- | ---------------------------------------- |
| **Simple**  | typo · rename · config · single file         | Auto-loaded (L1+L2+L3) only              |
| **Medium**  | 1–2 service changes · 1–3 endpoints          | + `/add-feature` prompt                  |
| **Complex** | saga · migration · new service · >3 entities | + `/add-feature` + SCHEMA.md + EVENTS.md |

When unsure → default to Complex (over-context safer than under-context).

## Learned Patterns (LCB v3 L6 — updated over time)

See `.github/PATTERNS.md` for accumulated patterns from past tasks.
