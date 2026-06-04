---
feature: Feed Ranking v1 — Complete Linear Scoring
domain: '@ai-ml'
level: L3
status: READY
created: 2026-06-05
related-fe: apps/web/src/app/page.tsx (home feed, đã có)
---

# Feed Ranking v1 — Complete Linear Scoring Function

## Goal

Hoàn thiện feed ranking scoring function để feed không trả về raw unranked events, dùng v1 linear model (không cần LambdaMART ở MVP).

## Read First

- `apps/feed-service/src/ranking/feed-ranker.service.ts` ← 234 lines, verify scoring completeness
- `apps/feed-service/src/feed.controller.ts`
- `infrastructure/postgres/SCHEMA.md` ← feed Redis key patterns
- `libs/events/src/events.ts` ← UserFollowedEvent

## Acceptance Criteria

- [ ] AC1: `GET /feed?userId=...` trả về ranked list, không phải raw Cassandra order
- [ ] AC2: Score tính đúng v1 formula với tất cả 5 signals
- [ ] AC3: A/B test: variant-1 vs variant-2 weights từ Redis `feed:ab:{userId}`
- [ ] AC4: Scored feed cached `feed:feat:user:{userId}` TTL=300s
- [ ] AC5: Celebrity pull merge hoạt động (follower_count > 10K)

## Domain Rules

- v1 formula: `Score = completionRate×0.30 + purchaseRate×0.20 + userInterestScore×0.20 + decayFactor×0.15 + shareRate×0.15`
- v2 formula (A/B variant): `relevance×0.6 + recency×0.2 + reputation×0.2`
- `decayFactor = e^(-0.1 × ageHours)`
- `userInterestScore = dot(userEmbed, contentEmbed)` — fetch `user:embed:{userId}` from Redis (TTL=5min)
- If userEmbed absent in Redis → use `interestScore = 0.5` (neutral)
- Sponsored boost: `×1.5` | Flash sale boost: `×1.3`
- Celebrity threshold: `follower_count > 10000` → pull model merge
- Feed seen dedup: `feed:seen:{userId}` SET TTL=86400s — skip already-seen IDs

## Tasks

1. Verify `FeedRankerService.score(event, userContext)` — fill in all 5 signal calculations
2. Implement `decayFactor` formula with `ageHours` from event `occurredAt`
3. Implement `userInterestScore` — fetch Redis `user:embed:{userId}`, dot product with `contentEmbed`
4. A/B weight resolver: read `feed:ab:{userId}` → select v1 or v2 weight set
5. `FeedService.getRankedFeed(userId, cursor, limit)`:
   - Fetch from Cassandra timeline (or mock list until ScyllaDB ready)
   - Score each event → sort desc
   - Filter `feed:seen:{userId}` — remove already-seen
   - Cache result `feed:feat:user:{userId}` TTL=300s
6. Business rule application: apply sponsored/flash-sale boosts after scoring

## Edge Cases

- `user:embed` not in Redis → use neutral score 0.5, do NOT block
- All events same score (cold start) → sort by `occurredAt` DESC as tiebreaker
- Empty feed → return `[]` not 404
- Cassandra not available → return cached `feed:feat:user:{userId}` if exists, else `[]`

## Skip

- LambdaMART / GBDT v2 — premature, needs training data first
- Content embedding generation — separate spec (qdrant-search-embedding)
- Feed post creation API — separate spec
- FE home feed update — see Related FE

## Related Specs / FE

- FE: `apps/web/src/app/page.tsx` — home feed, call `GET /api/feed` với cursor pagination
- Depends on: `qdrant-search-embedding.spec.md` for `user:embed` to be populated

## Fragments

+base +redis +verify-L3
