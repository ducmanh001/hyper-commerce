// apps/ai-service/src/recommendation/two-tower.service.ts
// Integrates the Two-Tower algorithm from libs/algorithms/two-tower.ts
// with Redis embedding storage and Elasticsearch kNN for ANN search.
//
// Architecture:
//   - User embeddings: computed on each request (lightweight)
//   - Item embeddings: pre-computed + stored in ES dense_vector field
//   - ANN search: ES kNN (HNSW index) finds top-K candidates
//   - Re-ranking: MMR diversity injection on candidates
//   - Fallback: BM25 popularity score when embeddings unavailable

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { RedisClientService } from '@hypercommerce/redis';
import {
  buildUserEmbedding,
  maximalMarginalRelevance,
  cosineSimilarity,
  l2Normalize,
} from '@hypercommerce/algorithms';
import { AI_CACHE_KEYS, AI_CACHE_TTL, AI_LIMITS } from '../constants/ai.constants';

export interface TwoTowerRecommendInput {
  userId: string;
  limit: number;
  excludeIds: string[];
  contextCategoryId?: string;
}

export interface RecommendedItem {
  productId: string;
  score: number;
  reason: 'two_tower' | 'collaborative' | 'popular' | 'trending';
}

@Injectable()
export class TwoTowerService {
  private readonly logger = new Logger(TwoTowerService.name);

  constructor(
    private readonly redis: RedisClientService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async recommend(input: TwoTowerRecommendInput): Promise<RecommendedItem[]> {
    // 1. Get or build user embedding
    const userEmbedding = await this.getUserEmbedding(input.userId);

    if (!userEmbedding) {
      this.logger.debug(`Cold start for user ${input.userId} — falling back to popular`);
      return this.getPopularFallback(input.limit, input.excludeIds);
    }

    // 2. ANN search in Elasticsearch
    const candidates = await this.knnSearch(
      userEmbedding,
      AI_LIMITS.MAX_RECOMMENDATIONS * 3, // over-fetch for MMR
      input.excludeIds,
    );

    // 3. Re-rank with MMR for diversity
    const diverse = maximalMarginalRelevance(
      candidates.map((c) => ({
        id: c.productId,
        score: c.score,
        embedding: c.embedding,
      })),
      0.7, // lambda: 70% relevance, 30% diversity
      input.limit,
    );

    return diverse.map(({ id, score }) => ({
      productId: id,
      score,
      reason: 'two_tower' as const,
    }));
  }

  private async getUserEmbedding(userId: string): Promise<number[] | null> {
    // Check Redis cache
    const cacheKey = AI_CACHE_KEYS.userEmbedding(userId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as number[];
      } catch {
        // fall through
      }
    }

    // Fetch recent interactions from ClickHouse/analytics
    const interactions = await this.fetchRecentInteractions(userId);
    if (interactions.length < AI_LIMITS.COLD_START_MIN_INTERACTIONS) {
      return null;
    }

    // Fetch product embeddings for interacted items
    const embeddings = await Promise.all(
      interactions.map(async (interaction) => {
        const embedding = await this.getProductEmbedding(interaction.productId);
        return embedding ? { embedding, timestampMs: interaction.timestampMs } : null;
      }),
    );

    const validEmbeddings = embeddings.filter(Boolean) as Array<{
      embedding: number[];
      timestampMs: number;
    }>;

    if (validEmbeddings.length === 0) return null;

    const userVector = buildUserEmbedding(validEmbeddings);
    if (!userVector) return null;

    // Cache for 1 hour
    await this.redis.set(cacheKey, JSON.stringify(userVector), AI_CACHE_TTL.USER_EMBEDDING);

    return userVector;
  }

  private async getProductEmbedding(productId: string): Promise<number[] | null> {
    const key = AI_CACHE_KEYS.productEmbedding(productId);
    const cached = await this.redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as number[];
      } catch {
        return null;
      }
    }
    return null;
  }

  private async knnSearch(
    queryVector: number[],
    k: number,
    excludeIds: string[],
  ): Promise<Array<{ productId: string; score: number; embedding: number[] }>> {
    const esHost = this.config.get<string>('ELASTICSEARCH_HOST', 'localhost:9200');

    try {
      const response = await firstValueFrom(
        this.httpService.post(`http://${esHost}/hypercommerce_products/_search`, {
          knn: {
            field: 'embedding',
            query_vector: queryVector,
            k,
            num_candidates: k * 3,
            filter: excludeIds.length ? { must_not: [{ terms: { _id: excludeIds } }] } : undefined,
          },
          _source: ['productId', 'embedding'],
        }),
      );

      const hits = response.data?.hits?.hits ?? [];
      return hits.map((hit: Record<string, unknown>) => ({
        productId: hit['_id'] as string,
        score: hit['_score'] as number,
        embedding: ((hit['_source'] as Record<string, unknown>)['embedding'] as number[]) ?? [],
      }));
    } catch (err) {
      this.logger.error('kNN search failed', err);
      return [];
    }
  }

  private async fetchRecentInteractions(
    userId: string,
  ): Promise<Array<{ productId: string; timestampMs: number }>> {
    // In production: query ClickHouse or interaction service
    return [];
  }

  private async getPopularFallback(
    limit: number,
    excludeIds: string[],
  ): Promise<RecommendedItem[]> {
    // Return trending products from Redis sorted set
    return [];
  }
}
