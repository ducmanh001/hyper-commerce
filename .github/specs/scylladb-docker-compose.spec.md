---
feature: ScyllaDB / Cassandra — docker-compose + Feed Timeline Schema
domain: '@infra'
level: L3
status: READY
created: 2026-06-05
related-fe: none
---

# ScyllaDB in Docker Compose + Feed Timeline Schema

## Goal

Thêm ScyllaDB vào docker-compose.yml để feed-service có thể dùng Cassandra-compatible timeline storage thay vì mock/array.

## Read First

- `infrastructure/docker-compose.yml`
- `apps/feed-service/src/app.module.ts`
- `apps/feed-service/src/repositories/` ← timeline repository
- `apps/feed-service/src/fanout/` ← fanout logic

## Acceptance Criteria

- [ ] AC1: `docker-compose up` → ScyllaDB khởi động thành công
- [ ] AC2: Health check endpoint ScyllaDB tại port 9042
- [ ] AC3: Init script tạo keyspace + `timeline_events` table khi container start
- [ ] AC4: feed-service kết nối được ScyllaDB qua env var
- [ ] AC5: `FeedTimelineRepository.insert()` và `query()` hoạt động với real ScyllaDB

## Domain Rules

- ScyllaDB port: 9042 (CQL), 9160 (Thrift — not needed)
- Keyspace: `hypercommerce`, replication factor=1 (dev), 3 (prod)
- Timeline schema:
  ```
  timeline_events (
    user_id     UUID,
    created_at  TIMESTAMP,
    event_id    UUID,
    event_type  TEXT,
    payload     TEXT,  -- JSON
    PRIMARY KEY (user_id, created_at, event_id)
  ) WITH CLUSTERING ORDER BY (created_at DESC)
  ```
- Partition key: `user_id` | Clustering: `created_at DESC`
- Feed fanout: ≤10K followers → write to each user's partition
- Celebrity (>10K) → pull merge at read time

## Tasks

1. Add `scylladb` service to `infrastructure/docker-compose.yml`:
   ```yaml
   scylladb:
     image: scylladb/scylla:5.4
     ports: ['9042:9042']
     volumes: [scylla-data:/var/lib/scylla]
     healthcheck: test cqlsh ping
   ```
2. Add init CQL script — create keyspace + `timeline_events` table
3. Add `SCYLLA_CONTACT_POINTS` env var to feed-service in docker-compose
4. Update `FeedTimelineRepository` — wire real ScyllaDB cassandra-driver client
5. Update `apps/feed-service/src/app.module.ts` — connect ScyllaDB on startup
6. Add `scylla-data` volume to docker-compose volumes section

## Edge Cases

- ScyllaDB slow start (up to 30s) → feed-service retry connection max 5 times with backoff
- Keyspace already exists → `CREATE KEYSPACE IF NOT EXISTS` (idempotent)

## Skip

- Multi-node ScyllaDB cluster (single node for dev)
- Kubernetes StatefulSet for prod (separate infra spec)
- Compaction strategy tuning
- Feed-service full fanout implementation (depends on this)

## Fragments

+base +verify-L3
