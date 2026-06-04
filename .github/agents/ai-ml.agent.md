---
description: AI/ML services — recommendation engine, fraud detection, embedding pipelines, vector search, NLP. Use when implementing ai-service, search-service, or libs/algorithms.
applyTo: 'apps/ai-service/**,apps/search-service/**,apps/analytics-service/**,libs/algorithms/**,libs/ai-agents/**'
---

# AI/ML Agent — Machine Learning & Intelligent Systems

## CONTEXT (read once, reuse)

You are an expert ML engineer working on HyperCommerce's AI systems.
Implementations are in TypeScript (serving layer) — models trained in Python offline.
**Load this context once.** Do not re-read algorithm files unless specifically asked.

## Architecture Overview

```
Offline Training (Python/PyTorch)         Online Serving (TypeScript/NestJS)
─────────────────────────────────         ─────────────────────────────────
ALS Matrix Factorization                  Two-Tower embedding lookup
LightGBM Fraud Classifier                 Rule engine + ML scoring fusion
CLIP Image+Text Embeddings                OpenAI API (text-embedding-3-large)
LambdaMART Feed Ranker                    Real-time ranking scoring
                │                                    │
                └──── ONNX export ────────────────────┘
                      (models/*)
```

## Recommendation System

Source: `libs/algorithms/src/two-tower.ts` (implemented) · `ai-service/src/recommendation/`

Pipeline: user context → **user embedding** (Redis `user:embed:{userId}`, 5min TTL) → **Qdrant ANN** top-200 candidates → **re-rank** (feature enrichment) → **business rules** (out-of-stock, blocked sellers) → top-N results

Redis keys: `user:embed:{userId}` (5min) · `rec:candidates:{userId}` (2min)
Qdrant: `products` collection — `{ id, vector: float[768], payload: { productId, sellerId, category, price, rating } }`

## Fraud Detection Pipeline

- **L1 Hard rules** (<1ms): velocity >10 orders/hr, device fingerprint mismatch, impossible geo (VN order + foreign IP)
- **L2 ML scoring** (<10ms, LightGBM): score >0.7→BLOCK · 0.4–0.7→REVIEW · <0.4→PASS
  - Features: order_amount, user_age_days, device_count, category_entropy, time_since_last_order, refund_rate
- **L3 Graph analysis** (async): ring detection, GNN Node2Vec on transaction graph

Redis: `fraud:score:{userId}` (1h) · `fraud:block:{userId}` (no TTL, manual)
Kafka: emits `fraud.detected` topic

## Embedding Pipeline (OpenAI)

> **Full code**: see `instructions/ml-patterns.instructions.md`

Model: `text-embedding-3-large`, `dimensions: 768` (truncated from 3072 for efficiency)
Input: `“{name} {description} {category}”` → upsert to Qdrant `products` collection
Cache: Redis `embed:product:{id}` (24h TTL) — batch on Kafka events, skip if content hash unchanged

## Feed Ranking Algorithm

Source: `feed-service/src/ranking/` — **scoring function incomplete, needs implementation**

v1 Linear: `Score = completionRate×0.30 + purchaseRate×0.20 + userInterestScore×0.20 + decayFactor×0.15 + shareRate×0.15`
v2 Target: LambdaMART GBDT — replace linear weights with gradient-boosted ranking
`decayFactor = e^(-0.1 × ageHours)` · `userInterestScore = dot(userEmbed, contentEmbed)`
Business signals: `isSponsored`, `hasFlashSale`, `sellerTrustScore` (from GMV + rating)

## Vector Search Hybrid (RRF)

Source: `libs/algorithms/src/rrf-fusion.ts` (implemented)

Formula: `score(d) = Σ 1/(k + rank(d, listᵢ))` — k=60, weights: BM25=0.5, kNN=0.4, trending=0.1
Flow: query understanding → parallel BM25 (ES) + kNN (Qdrant) → RRF fusion → personalization boost → business rules

## Qdrant Collections

```
Collection: "products"   → 768-dim, HNSW, cosine distance
Collection: "users"      → 256-dim, HNSW, cosine distance
Collection: "content"    → 768-dim (feed posts, live titles)
Collection: "knowledge"  → 1536-dim (agent memory, support docs)
```

## OpenAI Models Used

```
text-embedding-3-large (768-dim truncated) → product/content embeddings
gpt-4o-mini                                → agent routing, fast decisions
gpt-4o                                     → support agent, complex reasoning
gpt-4o-vision                              → product image moderation
```

## Known Issues to Fix

- ai-service: ALL ML pipelines are skeleton/placeholder — implement fully
- search-service: OpenAI embedding call is placeholder — wire real API
- Qdrant: client initialized but no collection created or data indexed
- Feed ranking: controller exists, scoring function missing
- Fraud detection: zero implementation, rule engine needed first
