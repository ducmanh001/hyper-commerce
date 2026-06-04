---
description: Implement Intelligent Feed Ranking Engine
mode: agent
---

# Feed Ranking Engine

> Spec: `infrastructure/postgres/SCHEMA.md` § feed-service (migration 008)  
> Pattern: extend `apps/feed-service/src/ranking/` + `fanout/` (already exist)  
> External: ai-service `:3010` GET `/api/v1/ai/embeddings/user/:userId` — graceful degrade to zero vector if unavailable

## Checklist

- [ ] Read SCHEMA.md § feed-service → write migration `008_feed_interactions.sql` → update SCHEMA.md
- [ ] `FeatureStoreService`: `getUserFeatures()` + `getSellerFeatures()` with Redis cache (TTL per SCHEMA.md); `getPostEmbedding()` cache from ai-service; `markSeen()` / `filterSeen()` via Redis SET
- [ ] `RecallService`: `getTimelineCandidates(userId, 500)` from ScyllaDB timelines table; `getCelebrityFeedCandidates()` pull mode for follower_count > 10K; fallback to PG if ScyllaDB not provisioned
- [ ] `ScoringService.scoreCandidate()`: `score = 0.5·cosine(userEmbed, postEmbed) + 0.3·exp(-0.1·ageHours) + 0.2·sellerReputation`; `cosineSimilarity()` handles zero-vector gracefully
- [ ] `AbTestService.getVariant()`: deterministic hash(userId) % 3 → Redis TTL=7d; variant-0=chronological, variant-1=weights(0.5/0.3/0.2), variant-2=weights(0.6/0.2/0.2)
- [ ] `FeedRankingService.getRankedFeed()`: recall 500 → filterSeen → score (parallel) → sort → 80% exploit + 10% explore + 10% ads slot reserved
- [ ] Update `feed.controller.ts`: GET `/feed` (cap limit=50), POST `/feed/seen` (batch mark), POST `/feed/not-interested` (HIDE interaction)
- [ ] Update fan-out consumer: `USER_FOLLOWED` + `isCelebrity=true` → skip fan-out, record in follows only
- [ ] Frontend: `apps/web/src/app/page.tsx` → `useInfiniteQuery` + IntersectionObserver for seen tracking (flush to POST `/feed/seen` every 10s); `FeedCard` component with LIVE badge

## Security (non-negotiable)

- `cursor` param: base64 + validate format → 400 on malformed
- `limit` cap at 50 — prevent bulk extraction
- A/B: deterministic hash (not random per request) — prevents variant manipulation
