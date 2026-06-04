---
feature: Search Page → Real API (gateway adapter + FE wire-up)
domain: '@frontend'
level: L2
status: READY
created: 2026-06-05
depends-on: qdrant-search-embedding.spec.md (DONE)
---

# Search Page — Wire Real API

## Goal

Search page hiện dùng đúng `/api/search` nhưng khi search-service UP, gateway trả về `{ hits, total, query, searchId }` còn FE expect `{ products, total, page, pageSize }`.  
Cần adapter trong gateway + cập nhật FE type để hiển thị corrected query.

## Read First

- `apps/api-gateway/server.js` line 1556–1580 (`/api/search` route)
- `apps/web/src/lib/api-client.ts` (`searchProducts` function)
- `apps/web/src/types/index.ts` (`SearchResult`, `Product`)
- `apps/web/src/app/search/page.tsx`

## Acceptance Criteria

- [ ] AC1: Gateway `/api/search` normalizes `hits → products` khi search-service UP
- [ ] AC2: `ProductHit` fields map đúng vào FE `Product` shape (`imageUrl → thumbnailUrl`, `sellerName`, `inStock → stockQuantity`)
- [ ] AC3: `SearchResult` type thêm optional `query?: { original, corrected }` — FE page hiển thị "Kết quả cho {corrected}" nếu corrected ≠ original
- [ ] AC4: `facets` từ search-service pass through tới FE (categories, priceRanges)
- [ ] AC5: `searchId` pass through — dùng cho click-tracking (store vào `data-search-id` attribute)

## Mapping: ProductHit → Product

```
hit.id            → product.id
hit.name          → product.name
hit.price         → product.price
hit.originalPrice → product.originalPrice
hit.imageUrl      → product.thumbnailUrl (và images: [hit.imageUrl])
hit.sellerId      → product.sellerId
hit.sellerName    → product.sellerName
hit.rating        → product.rating
hit.reviewCount   → product.reviewCount
hit.soldCount     → product.soldCount
hit.inStock       → product.stockQuantity (true→1, false→0)
— missing slug    → slug: hit.id (fallback)
— missing categoryId/Name → categoryId: '', categoryName: ''
— missing tags    → tags: []
```

## Tasks

1. **Gateway adapter** (`apps/api-gateway/server.js`, line ~1560): khi `svc.data.hits` exists, map → FE shape trước khi `res.json()`
2. **Type update** (`apps/web/src/types/index.ts`): thêm `query?: { original: string; corrected?: string }` và `searchId?: string` vào `SearchResult`
3. **Search page** (`apps/web/src/app/search/page.tsx`): hiển thị spell-correction hint nếu `result.query?.corrected && result.query.corrected !== result.query.original`

## Skip

- Autocomplete real API — separate spec
- Click-through rate tracking (searchId usage) — phase 2
- FE facet sidebar real data — separate spec
