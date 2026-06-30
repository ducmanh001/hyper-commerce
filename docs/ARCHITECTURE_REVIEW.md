# Architecture Review and Scaling Roadmap

## 1. Muc tieu tai lieu

Tai lieu nay tong hop danh gia kien truc hien tai cua `hypercommerce`, dua ra de xuat cai thien theo 8 nhom:

1. Kien truc he thong
2. Cau truc du an
3. Chuc nang moi va refactor
4. Cau truc du lieu va giai thuat
5. Ha tang
6. Tich hop AI cho phat trien phan mem
7. Mo rong quy mo khach hang
8. To chuc nhan su cho khoang 100 developer

Tai lieu nay uu tien tinh kha thi. Muc tieu khong phai la them that nhieu thanh phan, ma la xay dung duong di hop ly tu du an tam trung len quy mo lon.

## 2. Tom tat dieu hanh

### Nhan dinh nhanh

Repo hien tai dang o trang thai:

- Y tuong kien truc huong quy mo lon la dung
- Nen tang ky thuat da co nhieu thanh phan tot
- Nhung implementation van chua dong deu giua cac service
- Co mot so cho dang over-design so voi muc do truong thanh hien tai
- Nut that lon nhat la `api-gateway` dang om qua nhieu business logic va truy cap truc tiep ha tang

### Ket luan tong quan

He thong nay phu hop nhat neu di theo lo trinh sau:

- Giai doan 1: cung co quy mo tam trung that chac
- Giai doan 2: tach ro bounded context va ownership
- Giai doan 3: toi uu cho high-scale path
- Giai doan 4: chi khi traffic chung minh nhu cau moi tien len multi-region, cell-based architecture, live streaming ha tang rieng

Neu nhay thang len day du thanh phan cua internet-scale ngay tu dau, chi phi van hanh va do phuc tap to chuc se tang nhanh hon gia tri kinh doanh.

## 3. Hien trang repo hien tai

### 3.1 Diem manh

- Monorepo da tap hop nhieu service va libs chung trong cung mot workspace.
- Da co event-driven thinking voi Kafka, Redis, gRPC, ClickHouse, Qdrant, observability va KEDA.
- Mot so service da bat dau di theo huong clean architecture, CQRS, domain separation.
- FE dang dung `React Query + Zustand`, day la lua chon hop ly cho quy mo hien tai.
- Da co `outbox`, `idempotency`, `rate limiting`, `tracing`, day la cac nen tang tot de scale dung cach.

### 3.2 Diem yeu

- `apps/api-gateway/server.js` dang ket hop qua nhieu vai tro: auth, routing, REST endpoint, Socket.IO, query DB, cache, Kafka publish.
- Chua co boundary day du giua "edge layer" va "domain services".
- Shared Postgres van dong vai tro trung tam cho rat nhieu domain.
- Kien truc trong README mo ta rat lon, nhung implementation thuc te van con nhieu cho o muc prototype nang cap.
- Tooling monorepo hien tai la Nest monorepo, chua phai Nx hoac Turborepo dung nghia voi graph, cache, enforce boundary.
- Mot so thanh phan chi hop ly khi da co ops maturity cao, vi du service mesh day du, Cassandra cho feed, hay live quy mo lon.

### 3.3 Danh gia theo ma nguon hien tai

#### Muc tot

- `apps/user-service/src/app.module.ts`
  Cho thay service nay da co y thuc ve module hoa, lifecycle, clean boundary.
- `libs/database/src/database.module.ts`
  Da gom cau hinh DB dung chung theo env.
- `apps/order-service/src/saga/outbox-processor.service.ts`
  Da co outbox pattern cho at-least-once delivery.
- `apps/order-service/src/idempotency/idempotency.service.ts`
  Da co idempotency va Redis lock cho payment/order path.
- `infrastructure/kubernetes/keda.yaml`
  Da co tu duy scale theo queue lag thay vi chi scale theo CPU.

#### Muc can uu tien sua

- `apps/api-gateway/server.js`
  Dang la super-node, de tro thanh nut that ca ve ky thuat lan to chuc.
- `apps/web/src/lib/gateway.ts`
  Dang them mot lop proxy nua toi gateway, hop ly cho BFF, nhung can lam ro ownership va hop dong API.
- `apps/web/src/lib/store/auth.ts`
  Dang luu access token trong `localStorage`, khong tot cho security o production.
- `README.md`
  Mo ta he thong rat manh, nhung can dong bo hoa voi muc do san sang thuc te cua code.

## 4. De xuat theo 8 nhom

## 4.1 Kien truc he thong

### Nen giu

- Redis
- Kafka
- ClickHouse
- Elasticsearch
- Qdrant
- Outbox pattern
- Idempotency
- BFF cho web

### Nen them

- `catalog-service`
  Tach khoi `gateway` va cac endpoint tong hop khac. Day nen la source of truth cho product, category, seller catalog, media metadata, search indexing events.
- `pricing/promotion-service`
  Tach logic voucher, promotion, dynamic pricing, flash-sale pricing ra khoi order path.
- `identity-service`
  Ve lau dai tach `auth` khoi `user-profile`, vi auth, token, session, password policy, MFA va social login co vong doi khac profile.
- `edge gateway` dung nghia
  Gateway nen la mong:
  - authn/authz
  - routing
  - rate limit
  - request shaping
  - observability
    Khong nen chua business logic va truy cap data truc tiep.
- `read model / query service` cho cac API tong hop
  Thay vi moi page goi nhieu service runtime, nen co projection cho admin dashboard, seller dashboard, order timeline, feed summary.

### Nen bo bot hoac hoan lai

- Khong nen them them DB moi neu chua co domain can thiet ro rang.
- Cassandra chi hop ly neu feed/fanout that su la critical path va team co kha nang van hanh no.
- Full service mesh chi nen ap dung khi traffic, security va multi-team coordination that su can.

### Danh gia hop ly

Cho repo nay, kien truc hop ly nhat khong phai "them tat ca", ma la "lam mong duong di chinh":

- Browser -> CDN/WAF -> BFF/Edge -> Domain service -> Event bus -> Projection

Thay vi:

- Browser -> Nginx -> Next -> Gateway lon -> DB/Kafka/Redis va business logic tap trung

## 4.2 Cau truc du an

### Hien tai

- Monorepo la lua chon dung
- Nhung chua phat huy het loi ich cua monorepo quy mo lon

### De xuat

- Giu monorepo, khong can tach multi-repo luc nay.
- Nang cap thanh "platform monorepo":
  - Dung Nx hoac Turborepo that su
  - Co dependency graph
  - Co build cache
  - Co test affected
  - Enforce import boundary
- Tach `libs/common` thanh nhung nhom ro hon:
  - `libs/contracts`
  - `libs/platform`
  - `libs/testing`
  - `libs/domain-shared`
  - `libs/observability`
- Khong de business rule song trong `libs/common`.
- Ap dung `CODEOWNERS` theo domain.
- Them ADR folder:
  - `docs/adr/`
  - Moi quyet dinh lon phai co ADR ngan

### Vi sao hop ly

Voi team 100 nguoi, bai toan lon nhat khong phai la code chay duoc, ma la:

- biet ai so huu gi
- biet import nao duoc phep
- biet thay doi nao se anh huong service nao
- biet cach release an toan

Monorepo van rat hop ly, mien la co governance va tool boundary tot.

## 4.3 Chuc nang moi va refactor code

### Refactor uu tien cao

#### 1. Lam mong `api-gateway`

Can chuyen gateway ve dung vai tro edge layer:

- Bo business logic don hang, san pham, cart, notification khoi gateway
- Khong query Postgres truc tiep cho domain chinh
- Khong xem gateway la noi luu logic nghiep vu

Muc tieu:

- `api-gateway` thanh edge proxy + auth + rate limit + websocket coordination
- Domain state nam trong service so huu domain do

#### 2. Chuan hoa BFF

Next.js BFF dang hop ly, nhung can thong nhat:

- route nao goi gateway
- route nao goi service doc projection
- route nao cache o edge
- route nao phai dynamic

#### 3. Tach auth ra khoi local storage

Can doi:

- access token va refresh token sang `httpOnly cookie`
- local state chi luu user snapshot va UI state

#### 4. Chuan hoa event contract

Can co:

- schema versioning
- backward compatibility rule
- topic ownership
- dead-letter strategy

### Chuc nang moi nen them

- Seller catalog management day du
- Promotion engine
- Recommendation evaluation dashboard
- Search quality dashboard
- Feed experimentation platform
- Customer support timeline hop nhat
- Feature flags cho rollout theo tenant, seller tier, country

## 4.4 Cau truc du lieu va giai thuat

### Nen giu

- Bloom filter
- HyperLogLog
- Consistent hashing
- RRF cho hybrid search
- Redis Lua cho stock atomics

### Nen them

- Count-Min Sketch cho trending va spam/fraud light-weight counting
- Top-K heavy hitters cho search query, hashtag, live stream hot item
- Stable cursor pagination cho feed/search/order timeline
- Vector index evaluation pipeline
- Property-based testing cho money path

### Danh gia theo domain

#### Search

- Hien tai hybrid search la dung huong.
- Can them:
  - offline relevance set
  - query classification
  - typo model
  - dedup va diversification chuan hon

#### Feed

- Fan-out on write co the dung cho tam trung.
- Neu scale lon:
  - celebrity pull
  - multi-tier fanout queue
  - ranking cache by cohort
  - seen-state compact structure

#### Order/Payment

- Phai uu tien tinh dung hon tinh nhanh.
- Moi thuat toan lien quan tien, voucher, wallet can:
  - co invariant test
  - co replay test
  - co idempotency test

## 4.5 Ha tang

### Nen them ngay

- CDN cho static asset, image, product media
- WAF va edge rate limiting
- Secret manager
- Backup/restore drill
- Canary deployment
- GitOps
- SLO va alert theo user-facing journey
- Load testing dinh ky cho:
  - order path
  - feed path
  - search path
  - live websocket path

### Nen nang cap

- TLS va network hardening
- Private service-to-service traffic
- Standardized health/readiness/startup probe
- Pod disruption budget
- Zone spread
- Runtime cost dashboard theo service

### Nen hoan lai den khi can

- Full multi-region active-active
- Cell-based architecture
- Service mesh day du cho moi service

### Vi sao

He thong lon that su that bai khong phai vi thieu them 1 DB, ma vi:

- khong deploy an toan
- khong phuc hoi duoc
- khong biet khi nao he thong dang hu
- khong co boundary ve cost

## 4.6 Tich hop AI cho phat trien phan mem

### AI cho engineering

Nen ap dung AI vao:

- PR review tro ly
- Sinh test case tu contract
- Phan tich tac dong migration
- Sinh runbook tu incident postmortem
- Sinh draft ADR tu thay doi thiet ke
- Release note tu commit va diff

### AI cho san pham

Nen dau tu them:

- feature store online/offline
- model registry
- evaluation pipeline
- prompt/version registry cho agent
- fallback strategy khi AI service loi
- cost observability theo use case

### Nguyen tac

- Khong de AI chen thang vao money path ma khong co guardrail
- Moi output AI anh huong business can:
  - log
  - evaluate
  - version
  - rollback

## 4.7 Khach hang va bai toan "7 ti khach hang"

### Danh gia thang than

Muc tieu:

- 7 ti khach hang
- vai ti request dong thoi moi giay

La muc tieu vuot xa pham vi hop ly cua mot he thong e-commerce thong thuong, va vuot xa phan lon he thong san pham tren the gioi.

Voi repo hien tai, muc tieu hop ly hon la:

- Giai doan 1: 10k - 50k concurrent users tren core path
- Giai doan 2: 100k - 300k concurrent users theo su kien
- Giai doan 3: 1M concurrent users tren nhieu workload da tach
- Giai doan 4: multi-region, cell-based cho workload lon that su

### Live stream la diem can luu y dac biet

README mo ta huong WebRTC P2P mesh. Kien truc nay khong hop ly cho livestream mua sam quy mo lon.

Neu muon stream toi:

- hang nghin viewer
- hang chuc nghin viewer
- hay hon nua

Thi can chuyen sang SFU/media plane rieng:

- LiveKit
- mediasoup
- Janus
- hoac nha cung cap managed streaming

P2P mesh co the hop cho call nho, demo, hoac room quy mo rat thap. No khong phu hop cho live commerce lon.

## 4.8 Nhan su khoang 100 developer

### Co cau de xuat

- Squad Identity and User
- Squad Catalog and Search
- Squad Order and Payment
- Squad Inventory and Fulfillment
- Squad Feed and Live
- Squad Ads and Growth
- Squad Data and AI
- Platform and SRE
- Security and Compliance
- Developer Experience and Enablement

### Nguyen tac to chuc

- Chia theo domain, khong chia theo "frontend team / backend team" thuần tuy
- Moi squad so huu:
  - service
  - schema
  - topic
  - dashboard
  - on-call
  - SLA cua domain minh
- Platform team cung cap paved road, khong tro thanh bottleneck

### Nhung thu bat buoc khi len 100 nguoi

- ADR ngan
- API contract review
- Release train
- Incident management
- Ownership matrix
- Dependency governance
- Golden path cho service moi

## 5. So sanh voi du an tam trung va quy mo lon

| Hang muc  | Du an tam trung                             | Du an quy mo lon                                   | Repo hien tai nen lam gi                     |
| --------- | ------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| Kien truc | Modular monolith hoac microservice vua phai | Domain platform + cell-based                       | Giu monorepo microservices, lam mong gateway |
| DB        | Chu yeu Postgres + Redis                    | DB theo domain, projection, regional strategy      | Chua them DB moi, uu tien tach ownership     |
| Messaging | Kafka/SQS cho async quan trong              | Event backbone, schema governance day du           | Chuan hoa event contract va DLQ              |
| FE state  | React Query + Zustand                       | Them edge cache, streaming state, experiment infra | Giu nhu hien tai, tang BFF va security       |
| Live      | WebSocket + provider co san                 | SFU/media cluster rieng                            | Hoan mesh, chuan bi SFU neu live la core     |
| Search    | ES + filter + ranking co ban                | Hybrid retrieval, feature logging, evaluation      | Giu hybrid, them evaluation va dashboard     |
| Ha tang   | K8s/HPA, CI/CD, observability               | Multi-region, cell, chaos, cost controls           | Lam tot GitOps, SLO, backup, canary truoc    |
| To chuc   | 10-30 dev, it governance                    | 50-150+ dev, ownership rat chat                    | Can CODEOWNERS, ADR, squad ownership         |

## 6. Lo trinh de xuat

## Phase 0 - 4 tuan: Khoa nen tang

### Muc tieu

- Giam rui ro ky thuat
- Giam coupling
- Tao duong cho cac thay doi lon hon

### Cong viec

- Lam inventory kien truc va ownership
- Chot ADR cho gateway, auth, event contract
- Chuyen auth token sang `httpOnly cookie`
- Dinh nghia boundary cho `libs/common`
- Them `CODEOWNERS`
- Chot SLO cho `web`, `order`, `search`, `live`

### Ket qua mong doi

- Team dung chung ngon ngu kien truc
- Security tot hon
- De refactor ma it vo domino

## Phase 1 - 1 den 2 thang: Chuyen tu prototype nang cap sang medium-scale

### Muc tieu

- Loai bo super-node
- Chuan hoa giao tiep giua cac domain

### Cong viec

- Refactor `api-gateway` thanh edge gateway mong
- Them `catalog-service`
- Tien toi `pricing/promotion-service`
- Chuan hoa BFF route ownership
- Chuan hoa topic naming, schema versioning, DLQ
- Them canary deploy va rollback playbook

### Ket qua mong doi

- Moi domain co source of truth ro hon
- Gateway khong con la noi phong to nguy hiem
- Phat trien nhanh hon khi them team

## Phase 2 - 2 den 4 thang: Toi uu duong tai chinh va high-traffic path

### Muc tieu

- Chuan hoa money path
- Toi uu feed/search/live cho tai cao

### Cong viec

- Hardening order, payment, wallet, inventory invariant test
- Projection cho seller/admin dashboard
- Search relevance evaluation
- Feed ranking evaluation va experimentation
- CDN, WAF, edge cache cho content path
- Load test flash sale, live join, order burst

### Ket qua mong doi

- He thong chiu burst tot hon
- Co so lieu de quyet dinh, khong toi uu cam tinh

## Phase 3 - 4 den 8 thang: Chuan bi cho quy mo lon that su

### Muc tieu

- Dua cac thanh phan that su can scale lon len kien truc rieng

### Cong viec

- Tien toi DB ownership ro theo domain
- Tach auth service neu can
- SFU/media plane cho live commerce
- Cohort-based cache va projection cho feed/search
- Tenant/country rollout strategy
- Cost observability theo domain

### Ket qua mong doi

- He thong sang dang enterprise hon
- Tien gan toi quy mo lon ma khong be team

## Phase 4 - chi khi da chung minh traffic: large-scale platform

### Chi nen lam khi

- Da co traffic lon va on dinh
- Da co team SRE/Platform truong thanh
- Da co nhu cau multi-region that su

### Cong viec

- Cell-based architecture
- Regional sharding
- Multi-region read/write strategy
- Full DR drill
- Isolation theo tenant/market/seller cohort

## 7. Danh sach quyet dinh "giu / them / bo / hoan lai"

| Hang muc                      | Quyet dinh                    |
| ----------------------------- | ----------------------------- |
| Monorepo                      | Giu                           |
| NestJS microservices          | Giu                           |
| Redis                         | Giu                           |
| Kafka                         | Giu                           |
| ClickHouse                    | Giu                           |
| Elasticsearch + Qdrant        | Giu                           |
| Cassandra                     | Hoan lai neu chua co tai that |
| Full service mesh             | Hoan lai                      |
| Gateway business logic        | Bo dan                        |
| Catalog service               | Them                          |
| Pricing/Promotion service     | Them                          |
| Identity service              | Them sau                      |
| SFU cho live                  | Them khi live la core revenue |
| Edge cache/WAF/CDN            | Them ngay                     |
| Auth token trong localStorage | Bo                            |

## 8. Backlog uu tien cao nhat

1. Refactor `api-gateway` thanh edge layer mong.
2. Chuyen auth sang `httpOnly cookie`.
3. Tach `catalog-service`.
4. Chuan hoa event contract, schema versioning, DLQ.
5. Enforce monorepo boundary va ownership.
6. Them canary, SLO, load test cho `order`, `search`, `feed`, `live`.
7. Chot quyet dinh live commerce se theo P2P demo hay SFU production.

## 9. Kien nghi cuoi cung

Kien truc hien tai khong xau. Thuc te, no co nen tang rat tot. Van de lon nhat la do truong thanh khong dong deu:

- co cho da rat enterprise
- co cho van dang giong mot gateway tap trung mo rong dan

Huong di hop ly nhat la:

- khong dap di xay lai
- khong them them qua nhieu cong nghe
- tap trung vao boundary, ownership, reliability, va rollout an toan

Neu lam dung lo trinh, repo nay co the di tu "du an tam trung manh" len "nen tang lon va ben vung" ma khong tu tao ra qua nhieu operational burden qua som.
