---
description: Routing orchestrator — maps any question or task to the correct domain agent. Invoke manually when unsure which agent to use.
---

# Orchestrator — Domain Routing

> Auto-loading disabled (no applyTo). Routing summary is in copilot-instructions.md.
> Load this file only when you need full domain routing details.

## Domain → Agent Map

| Keywords                                                                                | Agent                | Services                      |
| --------------------------------------------------------------------------------------- | -------------------- | ----------------------------- |
| order, payment, stock, voucher, commission, review, rating, refund, dispute             | `commerce.agent.md`  | :3003 :3007 :3004 :3016       |
| user, auth, jwt, profile, follow, feed, live, stream, gift, subscription, chat, message | `social.agent.md`    | :3001 :3002 :3006 :3013 :3015 |
| notify, email, sms, push, analytics, report, dashboard, ad, campaign, auction, gmv      | `platform.agent.md`  | :3008 :3009 :3011 :3012       |
| search, elasticsearch, qdrant, vector, embedding, recommend, fraud, ml, ai              | `ai-ml.agent.md`     | :3005 :3010                   |
| web, page, component, react, next.js, ui, ssr, tailwind, zustand, tanstack              | `frontend.agent.md`  | :3000                         |
| docker, k8s, prometheus, grafana, kafka config, postgres migration, ci/cd               | `infra.agent.md`     | infrastructure/               |
| lib, shared, common, base entity, kafka producer, redis client, queue, events           | `backend.agent.md`   | libs/                         |
| architecture, design, pattern, sharding, cqrs, saga, api contract, new service          | `architect.agent.md` | —                             |

## When Adding a New Service

1. Assign port (next available after :3016)
2. Add to `nest-cli.json` projects
3. Add to `tsconfig.base.json` paths if new lib
4. Add to `docker-compose.yml`
5. Add to `infrastructure/kubernetes/services/`
6. Add Prometheus scrape target in `infrastructure/monitoring/prometheus.yml`
7. Create or update the relevant `.agent.md` for its domain
