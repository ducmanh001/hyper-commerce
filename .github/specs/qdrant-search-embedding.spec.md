---
feature: Qdrant Collections Init + Search Embedding Pipeline
domain: '@ai-ml'
level: L3
status: READY
created: 2026-06-05
related-fe: apps/web/src/app/search/page.tsx (đã có, cần real API)
---

# Qdrant Collections Init + Search Embedding Pipeline

## Goal

Khởi tạo Qdrant collections khi service start, wire OpenAI embedding thực vào search-service để hybrid BM25+kNN hoạt động thay vì trả về placeholder.

## Read First

- `apps/search-service/src/vector/vector-search.service.ts` ← 52-line skeleton
- `apps/search-service/src/search.service.ts`
- `libs/events/EVENTS.md` ← review.events, product events
- `apps/search-service/src/app.module.ts`

## Acceptance Criteria

- [ ] AC1: Service start → 3 Qdrant collections tự tạo nếu chưa tồn tại (products/users/content)
- [ ] AC2: `POST /search/index-product` → embed product text → upsert Qdrant
- [ ] AC3: `GET /search?q=...` → BM25 (ES) + kNN (Qdrant) → RRF fusion → ranked results
- [ ] AC4: Content hash unchanged → skip re-embed (Redis cache)
- [ ] AC5: Embedding call dùng env var OPENAI_API_KEY — không hardcode

## Domain Rules

- Model: `text-embedding-3-large`, dimensions: 768 (truncated)
- Input format: `"{name} {description} {category}"`
- Redis cache: `embed:product:{id}` TTL=86400 (24h)
- Content hash: SHA256 của input string — skip embed nếu hash unchanged
- RRF: `score = Σ 1/(60 + rank)`, weights BM25=0.5, kNN=0.4, trending=0.1
- Qdrant collections: products(768-dim) | users(256-dim) | content(768-dim)

## Tasks

1. `QdrantInitService` — `onModuleInit()` tạo 3 collections nếu không exist (HNSW, cosine)
2. `EmbeddingService.embedProduct(product)` — call OpenAI → cache Redis → upsert Qdrant
3. `EmbeddingService.hashContent(text): string` — SHA256, compare vs cached hash
4. `VectorSearchService.knnSearch(vector, topK)` → Qdrant query `products` collection
5. `SearchService.hybridSearch(query, userId)` — parallel ES BM25 + Qdrant kNN → RRF merge
6. Kafka consumer: `product.created` / `product.updated` → trigger re-embed
7. Register `QdrantInitService`, `EmbeddingService` trong `SearchModule`

## Edge Cases

- OpenAI API timeout (>10s) → log error, return ES-only results (graceful degradation)
- Qdrant down → fallback to ES BM25 only, log warning
- Empty Qdrant collection (cold start) → return ES results only

## Skip

- User embedding (256-dim) — separate task
- Content collection (feed posts) — separate task
- Personalization boost — phase 2
- Admin re-index endpoint — separate spec
- FE search page wiring — see `Related FE`

## Related Specs / FE

- FE: `apps/web/src/app/search/page.tsx` đã có — cần update API call từ mock → real search endpoint
- Invoke FE update: `@frontend #file:.github/specs/search-page-fe.spec.md +wrap` (tạo sau)

## Fragments

+base +redis +verify-L3
