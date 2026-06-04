---
description: Infrastructure, DevOps, observability — Docker Compose, Kubernetes, Terraform, Prometheus, Grafana, Kafka config, database migrations, CI/CD. Use when working on infrastructure files.
applyTo: 'infrastructure/**,docker-compose.yml,Dockerfile*,Makefile,.github/workflows/**'
---

# Infra Agent — DevOps & Infrastructure

## CONTEXT (read once, reuse)

You are a senior DevOps/SRE engineer working on HyperCommerce infrastructure.
**Load this context once.** Do not re-read config files unless specifically asked.

## Services Topology

```
External Traffic
    ↓ :80/:443
  Nginx (TLS termination, rate limit, static assets)
    ↓
  Next.js :3000   (SSR storefront)
  API Gateway :4000 (JWT auth, proxying, Socket.IO)
    ↓ HTTP internal
  14 NestJS Microservices (:3001-:3013)
    ↓
  Data Layer:
    PostgreSQL :5432  (Citus sharded, PgBouncer :6432)
    Redis :6379       (cache, Lua atomics)
    Kafka :9092       (event streaming, 6 partitions)
    Elasticsearch :9200 (BM25 search)
    ClickHouse :8123  (OLAP analytics)
    Qdrant :6333      (vector ANN)
    Cassandra :9042   (feed timelines — ADD TO DOCKER-COMPOSE)
```

## Docker Compose Service Naming

```yaml
# Pattern: service_name → container_name hypercommerce_{service}
# Networks: hypercommerce_network (bridge)
# Volumes: named volumes for all databases
# Health checks: all DBs need healthcheck before services start
```

## Critical Docker-Compose Gaps

```
1. Cassandra — NOT CONFIGURED (feed-service needs it)
   Add ScyllaDB (Cassandra-compatible, 5x faster):
   scylladb:
     image: scylladb/scylla:5.4
     ports: ["9042:9042"]
     volumes: ["scylla_data:/var/lib/scylla"]
     command: --overprovisioned 1 --smp 1

2. Kafka replication = 1 in dev (OK), but prod must be 3
   KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=3 (prod)
   KAFKA_MIN_INSYNC_REPLICAS=2 (prod)

3. Elasticsearch xpack.security disabled — OK for dev
   Prod: enable + create API keys per service

4. No dead letter queue (DLQ) topic in Kafka
   Add: order.dead-letter, payment.dead-letter, inventory.dead-letter
```

## Kubernetes Architecture (infrastructure/kubernetes/)

```yaml
# Per-service: Deployment + Service + HPA
# Resource requests/limits:
#   NestJS services: requests cpu=100m mem=256Mi, limits cpu=500m mem=512Mi
#   Redis: requests cpu=250m mem=512Mi, limits cpu=500m mem=1Gi
#   Kafka: requests cpu=500m mem=2Gi, limits cpu=2000m mem=4Gi

# HPA targets: 70% CPU utilization
# Istio sidecar injection: all services except Kafka/PG/Redis

# ConfigMaps: non-secret env vars
# Secrets: use Vault Agent Injector (not k8s secrets directly in prod)
```

## Prometheus Scrape Config

```yaml
# All NestJS services expose /metrics on their port
# Add custom business metrics:
- job_name: 'hypercommerce-business'
  static_configs:
    - targets: ['order-service:3003', 'payment-service:3007']
  metrics_path: '/metrics'
```

## Key Prometheus Metrics to Add

```
# Business KPIs
hypercommerce_gmv_total{currency="VND"}           counter
hypercommerce_orders_created_total{status}        counter
hypercommerce_conversion_rate                     gauge
hypercommerce_fraud_blocked_total{reason}         counter
hypercommerce_flash_sale_queue_depth{productId}   gauge
hypercommerce_livestream_concurrent_viewers       gauge

# Infrastructure
hypercommerce_kafka_consumer_lag{topic,group}     gauge
hypercommerce_redis_memory_used_bytes             gauge
hypercommerce_pg_connections_active               gauge
```

## Alerting Rules (alerts/)

```yaml
# Critical alerts (PagerDuty)
- alert: GMVDrop30Percent # GMV drops >30% vs 24h baseline
- alert: OrderSagaFailureSpike # >5% saga failure rate in 5min
- alert: FraudSpike # >50 blocked/5min
- alert: KafkaConsumerLag # lag > 10000 on any critical topic
- alert: RedisMemory90Percent # Redis memory > 460MB (90% of 512MB)
- alert: PGConnections80Pct # PG connections > 160 (80% of 200)

# Warning alerts (Slack)
- alert: DisputeRateHigh # dispute rate > 5%
- alert: ConversionRateLow # < 2% over 1 hour
- alert: FlashSaleQueueFull # queue > 9000/10000
```

## CI/CD Pipeline (.github/workflows/)

```yaml
# pr.yml — on PR to main
#   1. lint + typecheck
#   2. unit tests
#   3. docker build (verify no broken imports)
#   4. security scan (trivy for docker images)

# deploy.yml — on merge to main
#   1. build + push Docker images to ECR/GCR
#   2. kubectl set image (rolling update)
#   3. smoke tests
#   4. alert if rollout fails (auto-rollback)
```

## Environment Variables Pattern

```bash
# .env.example documents all required vars
# Production: HashiCorp Vault dynamic secrets
# Staging: AWS Secrets Manager
# Dev: .env file (in .gitignore)

# Required per service:
DATABASE_URL=postgresql://user:pass@pg:5432/hypercommerce
REDIS_URL=redis://:password@redis:6379
KAFKA_BROKERS=kafka:9092
JWT_SECRET=<from vault>
```

## Database Migrations

```bash
# TypeORM migrations in infrastructure/postgres/migrations/
# Run: npm run migration:run
# Generate: npm run migration:generate -- --name MigrationName
# NEVER edit existing migration files after deployment
```
