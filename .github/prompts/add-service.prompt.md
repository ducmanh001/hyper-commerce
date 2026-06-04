---
description: Add a new microservice to HyperCommerce. Use this checklist to ensure nothing is missed — from port assignment to Kubernetes.
---

# Add New Service Checklist

## Input

Service name: ${input:serviceName:Tên service, ví dụ: notification-v2}
Domain: ${input:domain:commerce|social|platform|ai-ml|infra}
Port: ${input:port:Next available port after :3016 — check docker-compose.yml}
Brief description: ${input:description:Service này làm gì}

## 1. Scaffold

- [ ] `npx nest g app ${serviceName}` hoặc tạo thư mục `apps/${serviceName}/src/` thủ công
- [ ] `apps/${serviceName}/tsconfig.app.json` — extend `../../tsconfig.base.json`
- [ ] `apps/${serviceName}/src/main.ts` — NestFactory.create, port từ env `${SERVICE_NAME}_PORT`

## 2. Register in monorepo

- [ ] `nest-cli.json` → thêm entry trong `projects`:
  ```json
  "${serviceName}": {
    "type": "application",
    "root": "apps/${serviceName}",
    "entryFile": "main",
    "sourceRoot": "apps/${serviceName}/src",
    "compilerOptions": { "tsConfigPath": "apps/${serviceName}/tsconfig.app.json" }
  }
  ```
- [ ] `tsconfig.base.json` → thêm path nếu service expose shared types

## 3. Docker

- [ ] `docker-compose.yml` → thêm service:
  ```yaml
  ${serviceName}:
    build: { context: ., dockerfile: Dockerfile.dev }
    command: npx nest start ${serviceName} --watch
    ports: ['${port}:${port}']
    environment:
      - PORT=${port}
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - KAFKA_BROKERS=${KAFKA_BROKERS}
    depends_on: [postgres, redis, kafka]
  ```
- [ ] `Dockerfile` (production) → thêm build stage nếu cần

## 4. API Gateway

- [ ] `apps/api-gateway/server.js` → thêm vào `INTERNAL_SERVICES`:
  ```js
  ${serviceName}: process.env.${SERVICE_NAME_UPPER}_URL ?? 'http://${serviceName}:${port}'
  ```
- [ ] Thêm proxy routes `/api/v1/${resource}/**`

## 5. Infrastructure

- [ ] `infrastructure/kubernetes/services/${serviceName}.yaml` — Deployment + Service
- [ ] `infrastructure/monitoring/prometheus.yml` → thêm scrape target

## 6. Database (nếu cần)

- [ ] Entity files: `apps/${serviceName}/src/entities/${name}.entity.ts`
- [ ] Migration: `infrastructure/postgres/migrations/{N}_{feature}_tables.sql`

## 7. Agent context

- [ ] Cập nhật `applyTo` của agent đúng domain:
  - Commerce: `commerce.agent.md`
  - Social: `social.agent.md`
  - Platform: `platform.agent.md`
  - AI/ML: `ai-ml.agent.md`
- [ ] Thêm port vào `copilot-instructions.md` port map

## 8. Verify

```bash
npx nest build ${serviceName}
npm run type-check
```
