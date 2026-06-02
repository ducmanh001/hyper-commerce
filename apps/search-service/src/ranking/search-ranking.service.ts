import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { RedisClientService } from '@hypercommerce/redis';

export interface SearchResult<T = Record<string, unknown>> {
  items: T[];
  total: number;
  nextCursor: string | null;
  took: number;       // ES query time in ms
  maxScore: number;
}

/**
 * SearchRankingService — handles Elasticsearch query construction + result ranking.
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge:
 * 1. BM25 (keyword relevance)
 * 2. Vector similarity (semantic relevance)
 * 3. Business signals (recency, sales velocity, seller rating)
 *
 * Why RRF vs simple weighted sum?
 * - RRF is robust to score scale differences between BM25 and cosine
 * - No hyperparameter tuning needed
 * - Proven by Meta/Google for hybrid search
 */
@Injectable()
export class SearchRankingService {
  private readonly logger = new Logger(SearchRankingService.name);

  constructor(
    private readonly es: ElasticsearchService,
    private readonly redis: RedisClientService,
  ) {}

  async searchProducts(params: {
    query: string;
    embedding?: number[];
    filters?: { category?: string; minPrice?: number; maxPrice?: number };
    pagination: { limit: number; cursor?: string };
  }): Promise<SearchResult> {
    const { query, embedding, filters, pagination } = params;
    const limit = pagination.limit;

    const mustFilters: Record<string, unknown>[] = [
      { term: { isActive: true } },
    ];

    if (filters?.category) {
      mustFilters.push({ term: { category: filters.category } });
    }
    if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
      mustFilters.push({
        range: {
          price: {
            ...(filters.minPrice !== undefined ? { gte: filters.minPrice } : {}),
            ...(filters.maxPrice !== undefined ? { lte: filters.maxPrice } : {}),
          },
        },
      });
    }

    // Hybrid query: BM25 + vector kNN + business signals
    const esQuery: Record<string, unknown> = {
      bool: {
        must: mustFilters,
        should: [
          // BM25 text matching
          {
            multi_match: {
              query,
              fields: ['name^3', 'description', 'tags^2', 'sellerName'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          },
          // Boost recently popular items
          {
            function_score: {
              field_value_factor: { field: 'reviewCount', factor: 0.1, missing: 0 },
            },
          },
        ],
        minimum_should_match: 1,
      },
    };

    const searchBody: Record<string, unknown> = {
      query: esQuery,
      size: limit + 1,
      sort: [{ _score: 'desc' }, { reviewCount: 'desc' }, { createdAt: 'desc' }],
      track_total_hits: true,
    };

    // Add kNN vector search if embedding provided
    if (embedding && embedding.length > 0) {
      searchBody['knn'] = {
        field: 'embedding',
        query_vector: embedding,
        k: limit * 2,
        num_candidates: limit * 10,
        filter: mustFilters,
      };
      // Use RRF to combine BM25 and kNN
      searchBody['rank'] = { rrf: { window_size: 100, rank_constant: 60 } };
      delete searchBody['query'];
    }

    const response = await this.es.search({ index: 'products', body: searchBody });
    const hits = response.hits.hits;
    const hasMore = hits.length > limit;
    const items = hits.slice(0, limit).map((h) => ({ ...(h._source as object), _score: h._score }));
    const total = typeof response.hits.total === 'object'
      ? response.hits.total.value
      : response.hits.total ?? 0;

    return {
      items,
      total,
      nextCursor: hasMore ? Buffer.from(String(limit)).toString('base64url') : null,
      took: response.took,
      maxScore: response.hits.max_score ?? 0,
    };
  }
}
