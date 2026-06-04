// ============================================================
// HYPERCOMMERCE — Search Service
// Hybrid search: BM25 keyword + kNN vector similarity → RRF merge
// + query understanding + personalization boost
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ElasticsearchService } from '@nestjs/elasticsearch';
import type { ConfigService } from '@nestjs/config';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type {
  QueryUnderstandingService,
  ParsedQuery,
} from './query-understanding/query-understanding.service';
import type { VectorSearchService } from './vector/vector-search.service';
import type { RankedResult } from './ranking/reciprocal-rank-fusion.helper';
import { ReciprocalRankFusionHelper } from './ranking/reciprocal-rank-fusion.helper';

export interface SearchRequest {
  query: string;
  userId?: string;
  filters?: {
    categoryIds?: string[];
    brandNames?: string[];
    priceMin?: number;
    priceMax?: number;
    inStock?: boolean;
    minRating?: number;
    sellerId?: string;
  };
  sort?: 'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'NEWEST' | 'RATING';
  page?: number;
  limit?: number;
  debug?: boolean;
}

export interface SearchResult {
  hits: ProductHit[];
  total: number;
  query: {
    original: string;
    corrected?: string;
    expansions?: string[];
    intent?: string;
  };
  facets?: SearchFacets;
  debug?: SearchDebugInfo;
  searchId: string; // For click-through rate tracking
}

export interface ProductHit {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  imageUrl: string;
  sellerId: string;
  sellerName: string;
  rating: number;
  reviewCount: number;
  soldCount: number;
  inStock: boolean;
  highlightedName?: string; // ES highlight
  score: number;
  rrfScore?: number;
  bm25Rank?: number;
  vectorRank?: number;
}

interface SearchFacets {
  categories: Array<{ id: string; name: string; count: number }>;
  brands: Array<{ name: string; count: number }>;
  priceRanges: Array<{ min: number; max: number; count: number }>;
  ratings: Array<{ rating: number; count: number }>;
}

interface SearchDebugInfo {
  bm25HitCount: number;
  vectorHitCount: number;
  afterFusionCount: number;
  queryUnderstanding: ParsedQuery;
  latencyMs: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly rrfHelper = new ReciprocalRankFusionHelper(APP_CONSTANTS.SEARCH_RRF_K);

  private readonly INDEX = 'products';
  private readonly DEFAULT_LIMIT = 20;
  private readonly MAX_LIMIT = 100;
  private readonly VECTOR_CANDIDATES = APP_CONSTANTS.SEARCH_KNN_CANDIDATES;

  constructor(
    private readonly esService: ElasticsearchService,
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
    private readonly queryUnderstanding: QueryUnderstandingService,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  /**
   * Main search pipeline — the most complex endpoint in the system.
   *
   * Steps:
   * 1. Query understanding (intent, spell correction, expansion)
   * 2. BM25 keyword search (ES full-text)
   * 3. kNN vector search (semantic similarity)
   * 4. RRF fusion (rank merging)
   * 5. Personalization boost (user history from Redis)
   * 6. Apply filters + sort
   * 7. Compute facets
   * 8. Return with debug info
   */
  async search(req: SearchRequest): Promise<SearchResult> {
    const startMs = Date.now();
    const page = req.page ?? 0;
    const limit = Math.min(req.limit ?? this.DEFAULT_LIMIT, this.MAX_LIMIT);
    const from = page * limit;

    // 1. Query understanding
    const parsedQuery = await this.queryUnderstanding.understand(req.query, req.userId);

    // Merge intent-detected filters with explicit filters
    const mergedFilters = this.mergeFilters(req.filters, parsedQuery);

    // 2+3. BM25 and vector search in parallel — P90 latency target: 50ms each
    // Note: vectorSearch requires an embedding vector; if not available, skip and use bm25 only
    const [bm25Results, vectorHits] = await Promise.all([
      this.bm25Search(parsedQuery, mergedFilters, from + limit * 3), // Fetch 3x for fusion
      // Generate query embedding is done inside VectorSearchService; we pass empty vector as placeholder
      // In production: embed parsedQuery.corrected via OpenAI → pass vector
      this.vectorSearch
        .search([], {
          index: this.INDEX,
          topK: this.VECTOR_CANDIDATES,
        })
        .catch(() => [] as Array<{ id: string; score: number }>),
    ]);

    // Map vectorHits to RankedResult[]
    const vectorRanked: RankedResult[] = vectorHits.map((h, idx) => ({
      id: h.id,
      score: h.score,
      rank: idx + 1,
    }));

    // 4. RRF fusion
    const [bm25Weight, vectorWeight] = this.rrfHelper.computeAdaptiveWeights(
      parsedQuery.tokens.length,
    );

    const fused = this.rrfHelper.fuseWeighted(
      [bm25Results.ranked, vectorRanked],
      [bm25Weight, vectorWeight],
    );

    // 5. Personalization boost
    const personalized = req.userId
      ? await this.applyPersonalizationBoost(fused, req.userId)
      : fused;

    // 6. Paginate
    const pageSlice = personalized.slice(from, from + limit);

    // 7. Hydrate with full product data (fetch from ES by IDs)
    const productIds = pageSlice.map((r) => r.id);
    const products = await this.hydrateProducts(productIds, parsedQuery);

    // 8. Build response with fusion metadata
    const hits: ProductHit[] = pageSlice
      .map((fusedItem) => {
        const product = products.get(fusedItem.id);
        if (!product) return null;
        return {
          ...product,
          score: fusedItem.rrfScore,
          rrfScore: req.debug ? fusedItem.rrfScore : undefined,
          bm25Rank: req.debug ? fusedItem.bm25Rank : undefined,
          vectorRank: req.debug ? fusedItem.vectorRank : undefined,
        } as ProductHit;
      })
      .filter((h): h is ProductHit => h !== null);

    const searchId = this.generateSearchId();
    const latencyMs = Date.now() - startMs;

    // Async: log search event for analytics + ML training
    this.logSearchEvent(searchId, req, parsedQuery, hits.length, latencyMs);

    return {
      hits,
      total: bm25Results.total + vectorRanked.length, // Approximate
      query: {
        original: req.query,
        corrected:
          parsedQuery.corrected !== parsedQuery.normalized ? parsedQuery.corrected : undefined,
        expansions: parsedQuery.expansions.length ? parsedQuery.expansions : undefined,
        intent: parsedQuery.intent.sortHint,
      },
      searchId,
      debug: req.debug
        ? {
            bm25HitCount: bm25Results.ranked.length,
            vectorHitCount: vectorRanked.length,
            afterFusionCount: fused.length,
            queryUnderstanding: parsedQuery,
            latencyMs,
          }
        : undefined,
    };
  }

  // ── BM25 Search ───────────────────────────────────────────

  private async bm25Search(
    parsedQuery: ParsedQuery,
    filters: Record<string, unknown>,
    size: number,
  ): Promise<{ ranked: RankedResult[]; total: number }> {
    const body = this.buildBM25Query(parsedQuery, filters, size);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.esService.search<any>({
      index: this.INDEX,
      body,
    } as Parameters<typeof this.esService.search>[0]);

    const rawHits =
      (response as unknown as { body?: { hits?: unknown } }).body?.hits ??
      (response.hits as unknown as {
        total: { value: number };
        hits: Array<{ _id: string; _score: number }>;
      });
    const hits = rawHits as {
      total: { value: number };
      hits: Array<{ _id: string; _score: number }>;
    };

    const ranked: RankedResult[] = hits.hits.map((hit, idx) => ({
      id: hit._id,
      score: hit._score ?? 0,
      rank: idx + 1,
    }));

    return { ranked, total: hits.total.value };
  }

  private buildBM25Query(
    parsedQuery: ParsedQuery,
    filters: Record<string, unknown>,
    size: number,
  ): Record<string, unknown> {
    const { corrected, tokens: _tokens, expansions, mustBoostTerms: _mustBoostTerms } = parsedQuery;

    const must: unknown[] = [
      {
        multi_match: {
          query: corrected,
          fields: [
            'name^3', // Title boost
            'brand_name^2',
            'category_name^2',
            'description',
            'tags',
            'search_text', // Denormalized search field
          ],
          type: 'best_fields',
          operator: 'or',
          fuzziness: 'AUTO', // Auto-detect typo tolerance by term length
          minimum_should_match: '60%', // At least 60% of terms must match
        },
      },
    ];

    const should: unknown[] = [
      // Exact match boost
      { match_phrase: { name: { query: corrected, boost: 2 } } },
      // Expansion terms (synonym boost — lower weight)
      ...expansions.map((term) => ({
        match: { search_text: { query: term, boost: 0.5 } },
      })),
      // Seller quality boost
      { range: { seller_score: { gte: 4.0, boost: 1.3 } } },
      // High sales boost (social proof)
      { range: { sold_count: { gte: 100, boost: 1.1 } } },
    ];

    const filter: unknown[] = this.buildFilters(filters);

    return {
      query: {
        bool: { must, should, filter },
      },
      size,
      highlight: {
        fields: { name: {}, description: { number_of_fragments: 1 } },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      _source: [
        'id',
        'name',
        'price',
        'original_price',
        'image_url',
        'seller_id',
        'seller_name',
        'rating',
        'review_count',
        'sold_count',
        'in_stock',
        'discount_percent',
      ],
    };
  }

  private buildFilters(filters: Record<string, unknown>): unknown[] {
    const esFilters: unknown[] = [];

    if (filters.inStock) esFilters.push({ term: { in_stock: true } });
    if (Array.isArray(filters.brandNames) && filters.brandNames.length)
      esFilters.push({ terms: { brand_name: filters.brandNames } });
    if (Array.isArray(filters.categoryIds) && filters.categoryIds.length)
      esFilters.push({ terms: { category_id: filters.categoryIds } });
    if (filters.sellerId) esFilters.push({ term: { seller_id: filters.sellerId } });
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      const rangeFilter: Record<string, number> = {};
      if (filters.priceMin !== undefined) rangeFilter.gte = filters.priceMin as number;
      if (filters.priceMax !== undefined) rangeFilter.lte = filters.priceMax as number;
      esFilters.push({ range: { price: rangeFilter } });
    }
    if (filters.minRating) esFilters.push({ range: { rating: { gte: filters.minRating } } });

    return esFilters;
  }

  // ── Personalization ───────────────────────────────────────

  private async applyPersonalizationBoost(
    results: ReturnType<ReciprocalRankFusionHelper['fuse']>,
    userId: string,
  ): Promise<typeof results> {
    // Fetch user's recently viewed products from Redis (last 50)
    const viewedKey = `user:viewed:${userId}`;
    const purchasedKey = `user:purchased:${userId}`;

    const [viewed, purchased] = await Promise.all([
      this.redis.smembers(viewedKey),
      this.redis.smembers(purchasedKey),
    ]);

    const viewedSet = new Set(viewed);
    const purchasedSet = new Set(purchased);

    return results
      .map((item) => {
        let rrfScore = item.rrfScore;

        // Boost viewed but not purchased (re-engagement signal)
        if (viewedSet.has(item.id) && !purchasedSet.has(item.id)) {
          rrfScore *= 1.15; // 15% boost
        }

        // Demote already purchased (reduce re-purchase noise)
        if (purchasedSet.has(item.id)) {
          rrfScore *= 0.5;
        }

        return { ...item, rrfScore };
      })
      .sort((a, b) => b.rrfScore - a.rrfScore);
  }

  // ── Hydration ─────────────────────────────────────────────

  private async hydrateProducts(
    ids: string[],
    _parsedQuery: ParsedQuery,
  ): Promise<Map<string, ProductHit>> {
    if (!ids.length) return new Map();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hydrateResponse = await this.esService.search<any>({
      index: this.INDEX,
      body: {
        query: { ids: { values: ids } },
        size: ids.length,
        _source: true,
      },
    } as Parameters<typeof this.esService.search>[0]);

    const rawHydrateHits =
      (hydrateResponse as unknown as { body?: { hits?: { hits: Array<Record<string, unknown>> } } })
        .body?.hits?.hits ??
      (hydrateResponse.hits?.hits as unknown as Array<Record<string, unknown>>) ??
      [];
    const hydrateHits = rawHydrateHits;
    const map = new Map<string, ProductHit>();

    for (const hit of hydrateHits) {
      const src = hit._source as Record<string, unknown>;
      map.set(hit._id as string, {
        id: hit._id as string,
        name: src.name as string,
        price: src.price as number,
        originalPrice: src.original_price as number | undefined,
        discountPercent: src.discount_percent as number | undefined,
        imageUrl: src.image_url as string,
        sellerId: src.seller_id as string,
        sellerName: src.seller_name as string,
        rating: src.rating as number,
        reviewCount: src.review_count as number,
        soldCount: src.sold_count as number,
        inStock: src.in_stock as boolean,
        score: 0, // Will be set by caller
      });
    }

    return map;
  }

  // ── Utilities ─────────────────────────────────────────────

  private mergeFilters(
    explicit: SearchRequest['filters'],
    parsed: ParsedQuery,
  ): Record<string, unknown> {
    return {
      ...parsed.filters,
      ...explicit,
      // Explicit filters win over detected
    };
  }

  private generateSearchId(): string {
    return `srch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private logSearchEvent(
    searchId: string,
    req: SearchRequest,
    parsed: ParsedQuery,
    hitCount: number,
    latencyMs: number,
  ): void {
    // Fire-and-forget — analytics doesn't block response
    setImmediate(() => {
      this.logger.log(
        JSON.stringify({
          event: 'search_performed',
          searchId,
          userId: req.userId,
          query: req.query,
          corrected: parsed.corrected,
          hitCount,
          latencyMs,
        }),
      );
    });
  }

  async autocomplete(prefix: string, _userId?: string): Promise<string[]> {
    const cacheKey = `autocomplete:${prefix.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as string[];

    const result = await this.esService.search({
      index: this.INDEX,
      size: 10,
      suggest: {
        suggestions: {
          prefix,
          completion: { field: 'suggest', skip_duplicates: true, size: 10 },
        },
      },
    } as Parameters<typeof this.esService.search>[0]);

    const suggestions = (
      (result as unknown as Record<string, unknown>)['suggest'] as
        | Record<string, unknown>
        | undefined
    )?.['suggestions'] as Array<{ options?: Array<{ text?: string }> }> | undefined;
    const texts = suggestions?.[0]?.options?.map((o) => o.text ?? '') ?? [];

    await this.redis.set(cacheKey, JSON.stringify(texts), 30);
    return texts;
  }

  async getTrendingSearches(limit = 10): Promise<string[]> {
    const key = 'trending:searches';
    const items = await this.redis.zrevrangeWithScores(key, 0, limit - 1);
    return items.map((i) => i.value);
  }

  async triggerIndex(productId: string): Promise<void> {
    // Re-index signal — actual re-fetch & index done by product.indexer
    this.logger.log(`Reindex triggered for product ${productId}`);
  }

  async findSimilar(productId: string, limit = 10): Promise<ProductHit[]> {
    const result = await this.esService.search<Record<string, unknown>>({
      index: this.INDEX,
      size: limit,
      query: {
        more_like_this: {
          fields: ['name', 'description', 'tags'],
          like: [{ _index: this.INDEX, _id: productId }],
          min_term_freq: 1,
          min_doc_freq: 1,
        },
      },
    });

    const hits = result.hits.hits;
    const emptyQuery: ParsedQuery = {
      raw: '',
      normalized: '',
      corrected: '',
      tokens: [],
      intent: { isBrandSearch: false, isPriceFilter: false, isCategorySearch: false },
      filters: {},
      expansions: [],
      mustBoostTerms: [],
    };
    const map = await this.hydrateProducts(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      hits.map((h) => h._id!),
      emptyQuery,
    );
    return hits.map(
      (h) =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        map.get(h._id!) ?? {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          id: h._id!,
          name: (h._source?.['name'] as string) ?? '',
          price: (h._source?.['price'] as number) ?? 0,
          imageUrl: '',
          sellerId: '',
          sellerName: '',
          rating: 0,
          reviewCount: 0,
          soldCount: 0,
          inStock: false,
          score: h._score ?? 0,
        },
    );
  }

  async indexProduct(product: Record<string, unknown>): Promise<void> {
    await this.esService.index({
      index: this.INDEX,
      id: product['id'] as string,
      document: { ...product, indexedAt: new Date().toISOString() },
    });
  }
}
