# HyperCommerce

> **Nền tảng thương mại điện tử đa nhà bán (multi-vendor e-commerce)** được xây dựng theo kiến trúc microservices hiệu năng cao, lấy cảm hứng từ TikTok Shop, Shopee và Lazada.
> Nguồn thu: **hoa hồng giao dịch**, **quảng cáo CPC/CPM**, và **gói đăng ký seller**.

---

## Mục lục

- [Tổng quan dự án](#tổng-quan-dự-án)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
- [Mô hình kỹ thuật áp dụng](#mô-hình-kỹ-thuật-áp-dụng)
- [Danh sách service](#danh-sách-service)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Tài khoản & Mật khẩu](#tài-khoản--mật-khẩu)
- [Biến môi trường](#biến-môi-trường)
- [Monitoring & Observability](#monitoring--observability)
- [Luồng nghiệp vụ chính](#luồng-nghiệp-vụ-chính)
- [Mô hình doanh thu](#mô-hình-doanh-thu)
- [Triển khai Production](#triển-khai-production)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Quy ước phát triển](#quy-ước-phát-triển)

---

## Tổng quan dự án

HyperCommerce là một monorepo NestJS (Nx) chứa **16 microservice** + **1 Next.js 14 storefront** + **1 Express API Gateway**. Dự án được thiết kế để chịu tải hàng triệu người dùng đồng thời với kiến trúc event-driven, eventual consistency, và horizontal scaling.

### Tính năng nổi bật

| Tính năng                 | Mô tả                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **Livestream mua sắm**    | WebRTC P2P — seller bật camera, viewer nhận stream thời gian thực   |
| **Flash sale 50K người**  | Redis Lua atomic + FIFO queue — không race condition                |
| **Feed cá nhân hóa**      | Fan-out on write (TikTok model) + ranking ML                        |
| **Tìm kiếm hybrid**       | BM25 (Elasticsearch) + kNN vector (Qdrant) + Reciprocal Rank Fusion |
| **Thanh toán đa cổng**    | VNPay, MoMo, Stripe — webhook idempotent                            |
| **Quảng cáo GSP auction** | Generalized Second-Price, budget atomic Lua script                  |
| **Fraud detection**       | AI-service scoring real-time theo đơn hàng                          |
| **Distributed tracing**   | OpenTelemetry → Jaeger, mỗi log có `traceId`                        |

---

## Kiến trúc hệ thống

```
                           NGƯỜI DÙNG
                    ┌──────────────────────┐
                    │  Browser / Mobile    │
                    └──────────┬───────────┘
                               │ HTTPS / WebSocket
                    ┌──────────▼───────────┐
                    │    Nginx :80 / :443   │
                    │  (reverse proxy, TLS) │
                    └──────────┬───────────┘
                               │
              ┌────────────────▼────────────────┐
              │   API Gateway (Express) :4000    │
              │  JWT auth · RBAC · Rate limit    │
              │  Socket.IO · WebRTC signaling    │
              └─┬──────┬──────┬──────┬──────────┘
                │      │      │      │
   ┌────────────▼─┐ ┌──▼──────▼──┐ ┌▼────────────┐
   │ Next.js :3000│ │NestJS      │ │NestJS       │
   │ (Storefront) │ │Microservices│ │Microservices│
   │ App Router   │ │:3001-3009  │ │:3010-3013   │
   └──────────────┘ └────┬───────┘ └──────┬──────┘
                         │                │
              ┌──────────▼────────────────▼──────┐
              │         KAFKA MESSAGE BUS         │
              │  Topics: user.*, order.*, live.*  │
              │  inventory.*, payment.*, analytics│
              └──┬─────────┬──────────┬───────────┘
                 │         │          │
        ┌────────▼──┐ ┌────▼────┐ ┌──▼───────────┐
        │PostgreSQL │ │  Redis  │ │ Elasticsearch │
        │ :5432     │ │ :6379   │ │  :9200        │
        │(PgBouncer │ │cache·   │ │FullText+kNN   │
        │ :6432)    │ │cart·    │ └──────────────┘
        └───────────┘ │session │ ┌──────────────┐
        ┌───────────┐ └────────┘ │  ClickHouse  │
        │ Cassandra │            │   :8123      │
        │  :9042    │            │  Analytics   │
        │feed·notif │            └──────────────┘
        └───────────┘            ┌──────────────┐
                                 │    Qdrant    │
                                 │   :6333      │
                                 │Vector search │
                                 └──────────────┘
```

### Luồng request điển hình

```
Browser → Nginx → Next.js BFF → API Gateway :4000 → PostgreSQL/Redis/Kafka
                                                    ↘ Socket.IO (WebRTC)
                                                    ↘ NestJS Microservices
```

---

## Mô hình kỹ thuật áp dụng

### 1. Event-Driven Architecture (Kafka)

Tất cả state change quan trọng được publish thành Kafka event trước khi trả về response. Consumer (analytics, notification, AI) xử lý bất đồng bộ — không block request chính.

```
POST /orders → Order Service → DB insert → Kafka: order.placed
                                         ↓ (async)
                             InventoryService: reserve stock
                             PaymentService: charge card
                             NotificationService: push "Đơn hàng đã đặt"
                             AnalyticsService: record GMV
```

### 2. Saga Choreography (không dùng 2PC)

Distributed transaction cho order không dùng Two-Phase Commit (deadlock risk). Thay vào đó dùng **Saga choreography** — mỗi service tự xử lý rollback khi nhận compensating event:

```
order.placed → inventory RESERVED → payment CHARGED → order CONFIRMED
     ↓ failure at any step
order.cancelled ← inventory RELEASED ← payment REFUNDED
```

### 3. Fan-out on Write (TikTok Feed model)

- **≤ 10K followers**: bài đăng được push vào Cassandra timeline của từng follower ngay khi publish → read O(1)
- **> 100K followers** (celebrity): không fan-out, follower pull on-demand để tránh 50M writes/post

### 4. Flash Sale — Redis Lua Atomic

```lua
-- Kiểm tra và giảm stock trong 1 atomic operation
local stock = redis.call('GET', KEYS[1])
if tonumber(stock) <= 0 then return 0 end
return redis.call('DECR', KEYS[1])
```

FIFO queue: `LPUSH flash:queue:{saleId} {userId}` → batch worker `RPOPLPUSH` 100 items → winner gets order.

### 5. Hybrid Search (BM25 + kNN)

```
Query: "áo thun nam" (query understanding → expand → vi/en)
  │
  ├─→ Elasticsearch BM25 ranking  (từ text match)
  ├─→ Qdrant kNN HNSW 768-dim    (từ embedding similarity)
  │
  └─→ Reciprocal Rank Fusion (k=60):  score = Σ 1/(60 + rank_i)
      → Personalization boost (view/purchase history)
      → Business rules (sponsored, margin, stock)
      → Top 20 results
```

### 6. GSP Ad Auction (Generalized Second-Price)

```
effectiveBid = maxBidVnd × √CTR_history   (Quality Score)
Winner pays  = nextBidder.effectiveBid + ₫1  (floor: ₫500)
Budget check = Redis Lua 2-key atomic DECRBY (lifetime + daily)
```

Bidding true value là dominant strategy — không bị bid-shading như first-price auction.

### 7. WebRTC Livestream (P2P Mesh)

```
Seller (Broadcaster)
  → getUserMedia() — camera + mic
  → RTCPeerConnection (STUN: stun.l.google.com:19302)
  → webrtc_offer via Socket.IO (API Gateway relay)
  → Viewer RTCPeerConnection
  → webrtc_answer → ICE candidates exchange
  → Direct P2P stream (không qua media server)
```

### 8. Circuit Breaker + Rate Limiting

API Gateway có per-user rate limiting (Redis sliding window). NestJS services dùng `@nestjs/throttler`. Alertmanager tự inhibit alert storms khi DB down.

### 9. Loki thay vì ELK

- **10x rẻ hơn**: Loki chỉ index labels (`service`, `level`) — không tokenize từng field như Elasticsearch
- **Native Grafana**: LogQL nằm cùng dashboard với PromQL
- **Không cần Logstash**: Promtail đọc Docker log stream trực tiếp
- **Retention đơn giản**: `retention_period: 720h` trong config

### 10. Citus cho PostgreSQL

Orders được shard theo `userId` — tất cả JOIN cho một đơn hàng (items, payments, disputes) nằm cùng 1 shard, loại bỏ cross-shard round-trips cho 95% queries ở scale lớn.

---

## Danh sách service

### Infrastructure (Docker)

| Service           | Port     | Mô tả                                              |
| ----------------- | -------- | -------------------------------------------------- |
| **PostgreSQL**    | 5432     | Primary DB — users, orders, payments, products     |
| **PgBouncer**     | 6432     | Connection pooler (transaction mode, 1000 clients) |
| **Redis**         | 6379     | Cache, sessions, cart, pub/sub, Lua atomic ops     |
| **Kafka**         | 29092    | Message bus (PLAINTEXT_HOST cho dev)               |
| **Kafka UI**      | 8080     | Web UI quản lý topics/consumers                    |
| **Elasticsearch** | 9200     | Full-text search + kNN vector                      |
| **ClickHouse**    | 8123     | OLAP analytics (HTTP interface)                    |
| **Qdrant**        | 6333     | Vector DB cho recommendation/semantic search       |
| **Cassandra**     | 9042     | Feed timeline, comments, activity log              |
| **Nginx**         | 80 / 443 | Reverse proxy, TLS termination                     |
| **Grafana**       | 9001     | Metrics + logs dashboard                           |
| **Prometheus**    | 9090     | Metrics scraping                                   |
| **Loki**          | 3100     | Log aggregation                                    |
| **Jaeger**        | 16686    | Distributed tracing UI                             |
| **Alertmanager**  | 9093     | Alert routing (Slack / PagerDuty)                  |

### Application Layer

| Service                  | Port     | Ngôn ngữ          | Mô tả                                                            |
| ------------------------ | -------- | ----------------- | ---------------------------------------------------------------- |
| **api-gateway**          | **4000** | Node.js (Express) | **Cổng duy nhất** — JWT auth, RBAC, Socket.IO WebRTC, REST proxy |
| **web**                  | **3000** | Next.js 14        | Storefront — App Router, SSR, BFF pattern                        |
| **user-service**         | 3001     | NestJS            | Đăng ký/đăng nhập, hồ sơ, seller onboarding                      |
| **feed-service**         | 3002     | NestJS            | Feed cá nhân hóa, fan-out, ranking                               |
| **order-service**        | 3003     | NestJS            | Vòng đời đơn hàng, Saga, hoa hồng, tranh chấp                    |
| **inventory-service**    | 3004     | NestJS            | Tồn kho real-time, flash sale, gRPC interface                    |
| **search-service**       | 3005     | NestJS            | Hybrid BM25 + kNN, query understanding                           |
| **live-service**         | 3006     | NestJS            | WebSocket sessions, viewer tracking                              |
| **payment-service**      | 3007     | NestJS            | VNPay, MoMo, Stripe — webhook idempotent                         |
| **notification-service** | 3008     | NestJS            | Email, push, SMS — multi-channel fan-out                         |
| **analytics-service**    | 3009     | NestJS            | Event ingestion → ClickHouse                                     |
| **ai-service**           | 3010     | NestJS            | Recommendations (ANN), fraud scoring                             |
| **admin-service**        | 3011     | NestJS            | Dashboard nội bộ (localhost-only)                                |
| **ads-service**          | 3012     | NestJS            | GSP auction engine, campaign management                          |
| **subscription-service** | 3013     | NestJS            | Gói seller, Stripe Billing                                       |
| **chat-service**         | 3015     | NestJS            | Tin nhắn real-time, conversations, Socket.IO                     |
| **review-service**       | 3016     | NestJS            | Reviews & ratings sản phẩm, helpful votes                        |
| **wallet-service**       | 3017     | NestJS            | Credit/debit ledger, cashback tự động, virtual coins             |

---

## Bắt đầu nhanh

### Yêu cầu

| Tool                    | Phiên bản tối thiểu | Ghi chú                              |
| ----------------------- | ------------------- | ------------------------------------ |
| Docker + Docker Compose | 24.x + v2           | `docker compose version` để kiểm tra |
| RAM                     | 8 GB                | 16 GB nếu chạy Elasticsearch         |
| Node.js                 | 22.x (optional)     | Chỉ cần nếu muốn chạy ngoài Docker   |

### Chạy toàn bộ hệ thống (1 lệnh)

```bash
git clone <repo-url> hypercommerce
cd hypercommerce

# Lần đầu: build images (~3-5 phút tùy mạng)
docker compose build

# Khởi động tất cả services
docker compose up -d
```

Sau khi up xong:

| URL                          | Service                            |
| ---------------------------- | ---------------------------------- |
| http://localhost:3000        | Storefront (Next.js)               |
| http://localhost:4000/health | API Gateway                        |
| http://localhost:8080        | Kafka UI                           |
| http://localhost:9001        | Grafana (`admin` / `admin_secret`) |
| http://localhost:9090        | Prometheus                         |
| http://localhost:16686       | Jaeger (Tracing)                   |

### Các lệnh thường dùng

```bash
# Xem trạng thái tất cả service
docker compose ps

# Xem log (tất cả)
docker compose logs -f

# Xem log một service cụ thể
docker compose logs -f api-gateway
docker compose logs -f web
docker compose logs -f order-service

# Restart một service (sau khi sửa code)
docker compose restart api-gateway

# Dừng tất cả (giữ data)
docker compose down

# Dừng và xóa toàn bộ data (volumes)
docker compose down -v

# Rebuild image sau khi thay đổi package.json
docker compose build --no-cache
docker compose up -d
```

### Tại sao không cần npm run dev nữa?

Docker Compose dùng **bind mount** — source code của bạn được mount trực tiếp vào container:

```yaml
volumes:
  - .:/app # source code → container (hot reload)
  - nestjs_modules:/app/node_modules # node_modules Node 20 (tránh conflict)
```

Khi bạn sửa file `.ts` trên máy host → NestJS `--watch` mode tự detect và reload.

> **Tại sao Node.js 20 trong Docker?** Node.js 22 có issue với ts-node và các file `.d.ts` trong `@casl`. Docker image dùng `node:20-alpine` nên hoàn toàn ổn định.

### (Tùy chọn) Chạy ngoài Docker

```bash
npm install

# Bắt buộc: khởi động infra trước
docker compose up -d postgres redis kafka zookeeper

# Terminal 1: API Gateway
npm run start:gateway

# Terminal 2: Web
cd apps/web && npm run dev

# Terminal 3+: NestJS services
npm run start:dev:user
npm run start:dev:order
```

### Quick test

```bash
# Kiểm tra API Gateway
curl http://localhost:4000/health

# Đăng nhập demo
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hypercommerce.vn","password":"password"}'

# Lấy danh sách sản phẩm
curl http://localhost:4000/api/products
```

---

## Tài khoản & Mật khẩu

### Demo accounts (built-in)

Các tài khoản này **không cần DB** — hoạt động ngay sau khi gateway khởi động:

| Email                     | Mật khẩu   | Vai trò    | Quyền                                             |
| ------------------------- | ---------- | ---------- | ------------------------------------------------- |
| `admin@hypercommerce.vn`  | `password` | **ADMIN**  | Toàn quyền — quản lý users, orders, feature flags |
| `seller@hypercommerce.vn` | `password` | **SELLER** | Quản lý sản phẩm, livestream, đơn hàng shop       |
| `user@hypercommerce.vn`   | `password` | **BUYER**  | Mua hàng, giỏ hàng, đặt đơn                       |

> Token demo có format `demo.<base64_payload>.sig` — Gateway decode nội bộ, không truy vấn DB.

Đăng nhập tại: http://localhost:3000/auth/login

### PostgreSQL

| Thông số              | Giá trị                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| **Host**              | `localhost`                                                                    |
| **Port**              | `5432` (trực tiếp) · `6432` (qua PgBouncer)                                    |
| **Database**          | `hypercommerce`                                                                |
| **Username**          | `hypercommerce`                                                                |
| **Password**          | `hypercommerce_secret`                                                         |
| **Connection string** | `postgresql://hypercommerce:hypercommerce_secret@localhost:5432/hypercommerce` |

```bash
# CLI
psql -h localhost -U hypercommerce -d hypercommerce
# password: hypercommerce_secret

# Kiểm tra tables do gateway tạo
psql -h localhost -U hypercommerce -d hypercommerce -c "\dt"
```

Các bảng do API Gateway tự tạo khi khởi động:

```sql
users           -- Tài khoản (bcrypt password, role: ADMIN/SELLER/BUYER)
products        -- Sản phẩm (random Unsplash image)
orders          -- Đơn hàng
order_items     -- Chi tiết đơn
live_streams    -- Phiên livestream
live_comments   -- Bình luận trong live
notifications   -- Thông báo
roles           -- Vai trò hệ thống
feature_flags   -- Bật/tắt tính năng runtime
audit_logs      -- Log thao tác admin
ad_campaigns    -- Chiến dịch quảng cáo
```

### Redis

| Thông số              | Giá trị                                |
| --------------------- | -------------------------------------- |
| **Host**              | `localhost`                            |
| **Port**              | `6379`                                 |
| **Password**          | `redis_secret`                         |
| **Connection string** | `redis://:redis_secret@localhost:6379` |

```bash
redis-cli -h localhost -p 6379 -a redis_secret ping
# PONG

# Xem giỏ hàng của user
redis-cli -a redis_secret GET "cart:user-id-here"

# Xem số viewer của livestream
redis-cli -a redis_secret GET "live:viewers:stream-id-here"
```

Keys quan trọng:
| Key pattern | Mô tả | TTL |
|---|---|---|
| `cart:{userId}` | Giỏ hàng (JSON array) | 7 ngày |
| `hc:seller:tier:{sellerId}` | Gói seller | 25 giờ |
| `live:viewers:{streamId}` | Số viewer live | Theo session |
| `hc:rate:{ip}:{endpoint}` | Rate limiting counter | 60 giây |
| `hc:product:cache:{id}` | Cache sản phẩm | 5 phút |

### Kafka

| Thông số                  | Giá trị               |
| ------------------------- | --------------------- |
| **Broker (từ host)**      | `localhost:29092`     |
| **Broker (từ container)** | `kafka:9092`          |
| **Kafka UI**              | http://localhost:8080 |

Topics và ý nghĩa:
| Topic | Publisher | Consumers | Mô tả |
|---|---|---|---|
| `user.registered` | api-gateway | notification | Chào mừng email |
| `order.placed` | api-gateway, order-service | inventory, payment, notification, analytics | Đơn hàng mới |
| `order.cancelled` | api-gateway | inventory, notification | Hủy đơn → release stock |
| `product.created` | api-gateway, seller | search, feed | Index sản phẩm mới |
| `live.started` | api-gateway | analytics, notification | Bắt đầu live |
| `live.ended` | api-gateway | analytics | Kết thúc live |
| `live.comment` | api-gateway | analytics | Bình luận live |
| `live.gift` | api-gateway | payment, analytics | Tặng quà live |
| `user.banned` | api-gateway | notification | User bị ban |

### Grafana

| Thông số     | Giá trị               |
| ------------ | --------------------- |
| **URL**      | http://localhost:9001 |
| **Username** | `admin`               |
| **Password** | `admin_secret`        |

### Elasticsearch

| URL                   | http://localhost:9200 |
| --------------------- | --------------------- |
| **Username/Password** | Không cần (dev mode)  |

```bash
curl http://localhost:9200/_cluster/health?pretty
curl http://localhost:9200/_cat/indices?v    # Liệt kê indices
```

### ClickHouse

| Thông số           | Giá trị               |
| ------------------ | --------------------- |
| **HTTP Interface** | http://localhost:8123 |
| **User**           | `default`             |
| **Password**       | (trống)               |

```bash
curl "http://localhost:8123/?query=SELECT+version()"
curl "http://localhost:8123/?query=SHOW+DATABASES"
```

### Jaeger (Distributed Tracing)

| URL                 | http://localhost:16686 |
| ------------------- | ---------------------- |
| Không cần đăng nhập | —                      |

Tìm trace: nhập `traceId` từ log vào ô **Trace ID** trên giao diện Jaeger.

### Công cụ khác

| Tool             | URL                             | Ghi chú                              |
| ---------------- | ------------------------------- | ------------------------------------ |
| **Prometheus**   | http://localhost:9090           | Không cần đăng nhập                  |
| **Alertmanager** | http://localhost:9093           | Không cần đăng nhập                  |
| **Kafka UI**     | http://localhost:8080           | Không cần đăng nhập                  |
| **Cassandra**    | `localhost:9042`                | `docker exec -it hc-cassandra cqlsh` |
| **Qdrant**       | http://localhost:6333/dashboard | Không cần đăng nhập                  |

---

## Biến môi trường

### Root `.env`

```dotenv
NODE_ENV=development

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=hypercommerce
DB_PASSWORD=hypercommerce_secret
DB_NAME=hypercommerce
DB_POOL_MAX=10
DB_POOL_MIN=2

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_secret

# Kafka
KAFKA_BROKERS=localhost:29092

# JWT
JWT_SECRET=hypercommerce_dev_jwt_secret_change_in_prod
JWT_EXPIRES_IN=86400

# Service ports
PORT=3005
INVENTORY_PORT=3002

# CORS
CORS_ORIGINS=http://localhost:3000

# Internal token
INTERNAL_SERVICE_TOKEN=internal_dev_token_change_in_prod
```

### `apps/web/.env`

```dotenv
# API Gateway
GATEWAY_URL=http://localhost:4000
NEXT_PUBLIC_GATEWAY_WS=http://localhost:4000

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change_this_in_production_use_openssl_rand_base64_32

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=HyperCommerce

# Redis (BFF)
REDIS_PASSWORD=redis_secret

# Internal
INTERNAL_SERVICE_TOKEN=internal_dev_token_change_in_prod
```

### Biến bắt buộc đổi khi lên production

```bash
# Generate JWT secret
openssl rand -base64 32

# Generate NextAuth secret
openssl rand -base64 32
```

| Biến                         | Lý do cần đổi                   |
| ---------------------------- | ------------------------------- |
| `JWT_SECRET`                 | Tối thiểu 32 ký tự random       |
| `NEXTAUTH_SECRET`            | Tương tự                        |
| `DB_PASSWORD`                | Không để `hypercommerce_secret` |
| `REDIS_PASSWORD`             | Không để `redis_secret`         |
| `INTERNAL_SERVICE_TOKEN`     | Token bí mật giữa các service   |
| `STRIPE_SECRET_KEY`          | Key thật từ Stripe Dashboard    |
| `VNPAY_HASH_SECRET`          | Key thật từ VNPay merchant      |
| `GF_SECURITY_ADMIN_PASSWORD` | Đổi mật khẩu Grafana            |

---

## Monitoring & Observability

### Tất cả URLs

| Tool                   | URL                             | Credentials              |
| ---------------------- | ------------------------------- | ------------------------ |
| **Storefront**         | http://localhost:3000           | Demo accounts            |
| **API Gateway**        | http://localhost:4000           | —                        |
| **API Gateway Health** | http://localhost:4000/health    | —                        |
| **Grafana**            | http://localhost:9001           | `admin` / `admin_secret` |
| **Prometheus**         | http://localhost:9090           | —                        |
| **Alertmanager**       | http://localhost:9093           | —                        |
| **Kafka UI**           | http://localhost:8080           | —                        |
| **Jaeger**             | http://localhost:16686          | —                        |
| **Elasticsearch**      | http://localhost:9200           | —                        |
| **ClickHouse**         | http://localhost:8123           | `default` / (trống)      |
| **Qdrant Dashboard**   | http://localhost:6333/dashboard | —                        |

### Grafana Dashboards

| Dashboard UID | Tên                 | Mô tả                                             |
| ------------- | ------------------- | ------------------------------------------------- |
| `hc-overview` | Platform Overview   | Request rate, error rate, p99 latency per service |
| `hc-business` | Business KPIs       | GMV, orders/phút, tỷ lệ thanh toán thành công     |
| `hc-infra`    | Infrastructure      | CPU, RAM, disk, container stats (cAdvisor)        |
| `hc-logs`     | Log Explorer        | Loki stream với level/service filter              |
| `hc-ads`      | Ads & Subscriptions | CTR, spend theo campaign, MRR subscription        |

### Distributed Tracing

Mọi log đều có `traceId`. Ví dụ filter trong Loki:

```logql
{service="order-service"} |= "traceId" | json | level = "error"
```

Click vào `traceId` trong Grafana → tự động mở Jaeger trace (derived field đã được cấu hình).

### Alert Routing

| Mức                | Ví dụ                                | Kênh                    |
| ------------------ | ------------------------------------ | ----------------------- |
| **Critical**       | `PostgresDown`, `PaymentGatewayDown` | PagerDuty + `#critical` |
| **Warning**        | `HighMemoryUsage`, `KafkaLagHigh`    | `#alerts` Slack         |
| **Business**       | `GMVDrop30pct`, `ConversionRateDrop` | `#business` Slack       |
| **Trust & Safety** | `FraudSpike`, `ChargebackRateHigh`   | `#trust-safety` Slack   |

---

## Luồng nghiệp vụ chính

### Đặt hàng

```
1. Buyer → POST /api/orders → Gateway → DB: insert order (PENDING)
2. Kafka publish: order.placed
   ├─ InventoryService: reserve stock (Redis DECR)
   ├─ PaymentService: charge (VNPay/MoMo/Stripe)
   │   ├─ success → Kafka: payment.succeeded
   │   │   → OrderService: CONFIRMED
   │   │   → NotificationService: "Đặt hàng thành công!"
   │   └─ failure → Kafka: payment.failed
   │       → InventoryService: release stock
   │       → OrderService: CANCELLED
   └─ AnalyticsService: record GMV event → ClickHouse
```

### Đăng ký & Đăng nhập

```
Register:
  POST /api/auth/register
  → bcrypt.hash(password, 12)
  → INSERT users (email, password_hash, full_name, role: BUYER)
  → Kafka: user.registered → NotificationService: welcome email
  → return JWT token

Login:
  POST /api/auth/login
  → SELECT user WHERE email = ?
  → bcrypt.compare(password, hash)
  → return JWT (real.<payload>.<sig>)

Demo accounts: hardcoded — không cần DB, không cần bcrypt
```

### Livestream (WebRTC P2P)

```
Seller (Broadcaster):
  1. Bật camera: getUserMedia({ video: true, audio: true })
  2. POST /api/seller/live-streams/:id/start → DB: status = LIVE
  3. Socket.IO: join_stream { role: 'broadcaster' }
  4. Khi viewer join: viewer_joined { viewerId }
     → createOffer → RTCPeerConnection → webrtc_offer
     → webrtc_answer từ viewer → setRemoteDescription
     → ICE candidate exchange → stream bắt đầu

Viewer:
  1. Socket.IO: join_stream { role: 'viewer' }
  2. webrtc_offer từ broadcaster → createAnswer → webrtc_answer
  3. ICE candidates exchange → nhận P2P video/audio stream
  4. Bình luận: send_comment → persist live_comments table
  5. Viewer count: realtime qua viewer_count event

Signaling relay: API Gateway Socket.IO (không qua media server)
STUN: stun:stun.l.google.com:19302
```

### Flash Sale (50K concurrent)

```
1. Admin tạo flash sale (thời gian bắt đầu, số lượng, giá)
2. InventoryService pre-warm: SET flash:stock:{saleId} 500 EX 3600
3. Buyer submit tại T=0: LPUSH flash:queue:{saleId} {userId}
4. Batch worker (mỗi 100ms):
   → RPOPLPUSH 100 users từ queue
   → Với mỗi winner: Lua DECR stock → ORDER_CREATED event
   → Với losers: SOLD_OUT notification
5. Khi stock = 0: Flash sale kết thúc, còn lại trong queue nhận SOLD_OUT
```

---

## Mô hình doanh thu

### Hoa hồng giao dịch

| Gói seller   | Tỷ lệ | Phí VNPay | Phí MoMo | Phí Stripe |
| ------------ | ----- | --------- | -------- | ---------- |
| FREE         | 5.0%  | 1.1%      | 1.5%     | 2.9% + ₫5K |
| BASIC        | 4.0%  | 1.1%      | 1.5%     | 2.9% + ₫5K |
| PROFESSIONAL | 3.0%  | 1.1%      | 1.5%     | 2.9% + ₫5K |
| ENTERPRISE   | 2.0%  | 1.1%      | 1.5%     | 2.9% + ₫5K |

### Quảng cáo CPC/CPM

| Loại    | Tính phí khi         | Ghi chú                                |
| ------- | -------------------- | -------------------------------------- |
| **CPC** | User click           | Async BullMQ — không block page render |
| **CPM** | Mỗi 1.000 impression | Trừ ngay khi auction thắng             |

Budget bảo vệ bằng Redis Lua atomic (lifetime budget + daily budget).

### Gói đăng ký seller

| Gói              | Giá / tháng  | Quyền lợi                                          |
| ---------------- | ------------ | -------------------------------------------------- |
| **FREE**         | ₫0           | Tối đa 50 sản phẩm                                 |
| **BASIC**        | ₫299,000     | Hoa hồng -1%, 100 sản phẩm                         |
| **PROFESSIONAL** | ₫799,000     | Hoa hồng -2%, 500 sản phẩm, badge, ₫200K ad credit |
| **ENTERPRISE**   | Thương lượng | Hoa hồng -3%, unlimited, SLA 4h                    |

---

## Triển khai Production

### Docker Compose (staging)

```bash
cd infrastructure
docker compose up -d
```

### Kubernetes

```bash
kubectl apply -f infrastructure/kubernetes/hypercommerce.yaml  # Deployments
kubectl apply -f infrastructure/kubernetes/istio.yaml          # mTLS mesh
kubectl apply -f infrastructure/kubernetes/keda.yaml           # Auto-scaling
```

KEDA scale `order-service` lên 20 replicas khi Kafka lag > 1.000 messages.

### Terraform

```bash
cd infrastructure/terraform
terraform init && terraform plan && terraform apply
```

### Production Checklist

- [ ] Đổi tất cả `*_secret` và `*_dev_*` thành giá trị ngẫu nhiên
- [ ] Enable TLS cho PostgreSQL, Redis, Kafka
- [ ] Redis Cluster mode (≥ 3 primary + 3 replica nodes)
- [ ] Kafka: `RF=3, min.insync.replicas=2, compression=snappy`
- [ ] Istio mTLS giữa tất cả microservices
- [ ] Rotate JWT secrets định kỳ (8h TTL admin, 24h TTL user)
- [ ] Stripe/VNPay webhook endpoint với secret thật
- [ ] Alertmanager Slack webhook + PagerDuty API key
- [ ] PostgreSQL `sslmode=require` + connection pool via PgBouncer
- [ ] Rate limiting tại Nginx layer (không chỉ ở application layer)
- [ ] CORS whitelist chỉ domain production

---

## Cấu trúc thư mục

```
hypercommerce/
├── apps/
│   ├── api-gateway/               # Express API Gateway (PORT 4000)
│   │   └── server.js              #   JWT · RBAC · Socket.IO · WebRTC · REST
│   ├── web/                       # Next.js 14 Storefront (PORT 3000)
│   │   └── src/
│   │       ├── app/               #   App Router — pages & BFF API routes
│   │       │   ├── api/           #   API routes (proxy tới Gateway)
│   │       │   ├── admin/         #   Trang quản trị
│   │       │   ├── seller/        #   Dashboard seller
│   │       │   ├── live/[id]/     #   Viewer livestream page
│   │       │   └── auth/          #   Login/Register pages
│   │       ├── components/        #   UI components dùng chung
│   │       └── lib/               #   Store (Zustand), gateway proxy util
│   ├── user-service/              # Auth, profiles, seller onboarding
│   ├── feed-service/              # Feed + fan-out + ranking ML
│   ├── order-service/             # Đơn hàng + Saga choreography + hoa hồng
│   ├── inventory-service/         # Tồn kho + flash sale + gRPC
│   ├── search-service/            # Hybrid BM25 + kNN + query understanding
│   ├── live-service/              # WebSocket sessions + viewer tracking
│   ├── payment-service/           # VNPay, MoMo, Stripe + webhook idempotent
│   ├── notification-service/      # Email / push / SMS fan-out
│   ├── analytics-service/         # Event ingestion → ClickHouse OLAP
│   ├── ai-service/                # Recommendations (ANN) + Fraud scoring
│   ├── admin-service/             # Dashboard nội bộ (127.0.0.1:3011)
│   ├── ads-service/               # GSP auction engine, campaign management
│   ├── subscription-service/      # Gói seller, Stripe Billing
│   ├── chat-service/              # Tin nhắn real-time, conversations
│   ├── review-service/            # Reviews & ratings, helpful votes
│   └── wallet-service/            # Credit/debit ledger, cashback, coins
│
├── libs/                          # Shared libraries (NestJS monorepo)
│   ├── common/                    #   Guards, filters, decorators, exceptions
│   ├── database/                  #   TypeORM base config
│   ├── events/                    #   Kafka event types + EVENTS.md routing catalog
│   ├── grpc/                      #   Proto definitions + PROTOS.md catalog + gRPC clients
│   ├── kafka/                     #   KafkaProducerService wrapper
│   ├── redis/                     #   RedisClientService wrapper
│   ├── queue/                     #   BullMQ helpers + QUEUES.md job catalog
│   ├── algorithms/                #   Ranking, scoring, ANN utilities
│   └── tracing/                   #   OpenTelemetry → Jaeger distributed tracing
│
└── infrastructure/
    ├── docker-compose.yml         # Local development full stack
    ├── kubernetes/
    │   ├── hypercommerce.yaml     #   Tất cả Deployments + Services
    │   ├── istio.yaml             #   mTLS + VirtualService + DestinationRule
    │   ├── keda.yaml              #   Auto-scaling theo Kafka consumer lag
    │   └── services/             #   Per-service ConfigMaps và Secrets
    ├── monitoring/
    │   ├── prometheus.yml         #   Scrape configs cho tất cả services
    │   └── alerts/               #   Alerting rules (PromQL expressions)
    ├── nginx/
    │   └── conf.d/               #   Upstream routing, rate limit, cache
    └── terraform/
        └── main.tf               #   Cloud IaC (AWS/GCP/Azure)
```

---

## Quy ước phát triển

### Code conventions

```
Entity classes:  strictPropertyInitialization: false (TypeORM pattern)
Service inject:  Chỉ dùng constructor injection — không @Inject() token magic
Exceptions:      throw từ @hypercommerce/common/exceptions/ domain exceptions
                 Không throw new Error() trong business logic
Kafka events:    Schema định nghĩa ở libs/events/src/ — mọi event có traceId
Redis keys:      Prefix hc: format hc:<domain>:<entity>:<id>
                 Ví dụ: hc:seller:tier:abc123  /  hc:product:cache:prod-001
SQL:             Luôn dùng parameterized queries ($1, $2) — không concatenate string
```

### Git workflow

```bash
git checkout -b feat/my-feature   # branch từ main
# ... implement ...
npx tsc --noEmit                  # TypeScript check — phải 0 error
npm test                          # Unit tests
git push origin feat/my-feature
# Mở Pull Request → review → merge
```

**Commit format** (enforced by commitlint + husky):

```
type(scope): subject          ← max 72 chars, imperative mood

Optional body lines           ← max 72 chars each
```

Types: `feat` `fix` `docs` `chore` `refactor` `perf` `test` `style` `ci` `revert`
Full guide: `.github/COMMIT_CONVENTION.md`

### Thêm service mới

1. Tạo `apps/my-service/src/`
2. Đăng ký trong `nest-cli.json`
3. Thêm script `start:dev:my-service` vào `package.json`
4. Thêm proxy route tại `apps/api-gateway/server.js`
5. Dùng Kafka consumer/producer theo pattern của `order-service`
6. DB writes multi-table → dùng Outbox pattern (xem `wallet-service`)
7. Expose `/metrics` endpoint cho Prometheus
8. Thêm `traceId` vào mọi Kafka event và log entry
9. Chạy `make context:refresh` sau khi thêm entity mới

### AI Developer Tooling

```bash
make context:refresh     # Regenerate SCHEMA.md + QUEUES.md + PROTOS.md
npm run context:index    # SCHEMA.md only
npm run context:catalogs # QUEUES.md + PROTOS.md only
```

Catalog files tự động cập nhật khi commit:

- `queue.constants.ts` thay đổi → `libs/queue/QUEUES.md` auto-update
- `*.proto` thay đổi → `libs/grpc/PROTOS.md` auto-update

Feature specs: `.github/specs/*.spec.md` — invoke với `@agent #file:.github/specs/name.spec.md +wrap`
Fragment library: `.github/prompts/fragments/` — +base +kafka +redis +tx +migration
AI dev guide: `.github/AI_DEV_GUIDE.md`

### Bảo mật (OWASP Top 10)

| Layer                | Giải pháp                                                      |
| -------------------- | -------------------------------------------------------------- |
| **Auth**             | JWT (user 24h TTL, admin 8h TTL) — 2 secret riêng biệt         |
| **RBAC**             | `requireRole('ADMIN','SELLER','BUYER')` middleware tại Gateway |
| **Inter-service**    | `INTERNAL_SERVICE_TOKEN` header bắt buộc                       |
| **Rate limiting**    | Redis sliding window per-IP per-endpoint                       |
| **Input validation** | `class-validator` + DTO tại mọi controller boundary            |
| **SQL injection**    | Parameterized queries — tuyệt đối không concatenate            |
| **XSS**              | Next.js auto-escape + CSP header tại Nginx                     |
| **Secrets**          | `.env` không commit — dùng `.env.example` làm template         |
| **Logging**          | Không log password, token, PAN (credit card) vào Loki          |

---

_HyperCommerce — Xây dựng cho scale, thiết kế cho thị trường thương mại điện tử Việt Nam._
