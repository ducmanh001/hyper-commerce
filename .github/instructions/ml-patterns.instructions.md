---
applyTo: 'apps/ai-service/**/*.ts,apps/search-service/**/*.ts,libs/algorithms/**/*.ts'
---

# ML Patterns — OpenAI · Qdrant · Embedding Pipeline

## OpenAI Embedding

```typescript
import { OpenAI } from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Embed text (product, content, user query)
async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
    dimensions: 768, // truncated from 3072 — balance cost vs quality
  });
  return res.data[0].embedding;
}

// Product input: `${product.name} ${product.description} ${product.category}`
// Cache result: Redis key `embed:product:{id}`, TTL=86400 (24h)
// Skip re-embed: compare SHA-256 hash of input text before calling API
```

## Qdrant Upsert

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL });

await qdrant.upsert('products', {
  wait: true,
  points: [
    {
      id: product.id, // UUID string
      vector: embeddingVector, // float[768]
      payload: {
        productId: product.id,
        sellerId: product.sellerId,
        category: product.categoryId,
        price: product.price,
        rating: product.averageRating ?? 0,
        inStock: product.stockCount > 0,
      },
    },
  ],
});
```

## Qdrant Search (kNN)

```typescript
const results = await qdrant.search('products', {
  vector: queryVector,
  limit: 200, // over-fetch for RRF re-ranking
  filter: {
    must: [{ key: 'inStock', match: { value: true } }],
  },
  with_payload: true,
});
// Returns: Array<{ id, score, payload }>
```

## Batch Embedding (Kafka Consumer pattern)

```typescript
// Listen on product.created / product.updated events
@EventPattern('product.events')
async handleProductEvent(@Payload() event: ProductUpdatedEvent) {
  const key = `embed:product:${event.productId}`;
  const inputText = `${event.name} ${event.description} ${event.category}`;
  const hash = createHash('sha256').update(inputText).digest('hex');

  // Skip if content unchanged
  const cachedHash = await this.redis.get(`${key}:hash`);
  if (cachedHash === hash) return;

  const vector = await embed(inputText);
  await this.redis.set(key, JSON.stringify(vector), 86400);
  await this.redis.set(`${key}:hash`, hash, 86400);
  await qdrant.upsert('products', { wait: false, points: [{ id: event.productId, vector, payload: { ...} }] });
}
```

## Redis Keys (AI/ML service)

```
embed:product:{id}          → float[] JSON, TTL=24h
embed:product:{id}:hash     → SHA-256 of input text, TTL=24h
embed:user:{userId}         → user preference vector, TTL=5min
rec:candidates:{userId}     → ANN result list, TTL=2min
fraud:score:{userId}        → ML fraud score (0-1), TTL=1h
fraud:block:{userId}        → manual block flag, no TTL
search:cache:{queryHash}    → search result cache, TTL=5min
```

## Cost Controls (always apply)

- Cache ALL embeddings — OpenAI API costs $0.13/1M tokens for text-embedding-3-large
- Batch events: use BullMQ queue `QUEUE_NAMES.EMBEDDING` to debounce rapid product updates
- Dimensions: always use 768, never 3072 (same quality, 4× less Qdrant storage)
- Rate limit: max 500 embed calls/min per service instance
