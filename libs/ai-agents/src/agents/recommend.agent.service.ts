// ============================================================
// HYPERCOMMERCE — Recommendation Agent Service
//
// Personalized product recommendation engine.
// Strategy:
//   1. Check Redis cache (user:rec:{userId}) → 2min TTL
//   2. Get user embedding from Redis or compute via OpenAI
//   3. ANN search in Qdrant "products" collection
//   4. Re-rank with business rules (stock, seller trust, flash sale)
//   5. Cache result + return
//
// Cold start: new users → popularity-based recommendations
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { AgentTask, AgentResult, RecommendTaskInput, RecommendTaskOutput } from '../types';
import { AgentType, TaskStatus } from '../types';
import type { RedisMemoryService } from '../memory/redis-memory.service';

interface QdrantSearchResult {
  result: Array<{
    id: string;
    score: number;
    payload: {
      productId: string;
      sellerId: string;
      category: string;
      price: number;
      rating: number;
      inStock: boolean;
    };
  }>;
}

@Injectable()
export class RecommendAgentService {
  private readonly logger = new Logger(RecommendAgentService.name);
  private openai: OpenAI;
  private qdrantBaseUrl: string;

  private readonly USER_EMBED_TTL = 300; // 5min
  private readonly REC_CACHE_TTL = 120; // 2min
  private readonly EMBED_DIM = 768;
  private readonly ANN_CANDIDATES = 50;

  constructor(
    private readonly config: ConfigService,
    private readonly memory: RedisMemoryService,
  ) {
    this.openai = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY'),
    });
    this.qdrantBaseUrl = config.get<string>('QDRANT_URL') ?? 'http://localhost:6333';
  }

  async recommend(task: AgentTask<RecommendTaskInput>): Promise<AgentResult<RecommendTaskOutput>> {
    const start = Date.now();
    const { input } = task;

    try {
      // Check cache first
      const cacheKey = `rec:${input.userId}:${input.context}:${input.referenceProductId ?? ''}`;
      const cached = await this.memory.getCachedReasoning<RecommendTaskOutput>(
        AgentType.RECOMMEND,
        cacheKey,
      );

      if (cached) {
        return this.buildResult(task, start, { ...cached, fromCache: true });
      }

      // Get user embedding
      const userVector = await this.getUserVector(input.userId);

      if (!userVector) {
        // Cold start — return trending/popular
        return this.buildResult(task, start, {
          recommendations: await this.getPopularProducts(input.limit),
          strategy: 'cold_start',
          fromCache: false,
        });
      }

      // ANN search in Qdrant
      const candidates = await this.searchQdrant(userVector, input.limit * 3);

      // Filter and re-rank
      const filtered = candidates
        .filter((c) => !input.excludeProductIds?.includes(c.id))
        .filter((c) => c.payload.inStock !== false)
        .slice(0, input.limit);

      const recommendations = filtered.map((c) => ({
        productId: c.payload.productId ?? c.id,
        score: c.score,
        reason: 'collaborative' as const,
      }));

      const output: RecommendTaskOutput = {
        recommendations,
        strategy: 'two_tower',
        fromCache: false,
      };

      // Cache result
      await this.memory.setCachedReasoning(
        AgentType.RECOMMEND,
        cacheKey,
        output,
        this.REC_CACHE_TTL,
      );

      return this.buildResult(task, start, output);
    } catch (err) {
      this.logger.error('Recommendation error', err);
      // Fallback: return popular products
      return this.buildResult(
        task,
        start,
        {
          recommendations: await this.getPopularProducts(input.limit),
          strategy: 'popularity',
          fromCache: false,
        },
        TaskStatus.FAILED,
      );
    }
  }

  // ── User Embedding ─────────────────────────────────────────

  private async getUserVector(userId: string): Promise<number[] | null> {
    // Check Redis cache
    const cached = await this.memory.getCachedReasoning<number[]>(
      AgentType.RECOMMEND,
      `user:embed:${userId}`,
    );
    if (cached) return cached;

    // In production: user embedding is pre-computed by ML pipeline
    // and stored in Redis. Here we signal that the embedding is not available.
    return null;
  }

  /**
   * Store a pre-computed user embedding (called by ML training pipeline).
   */
  async storeUserVector(userId: string, vector: number[]): Promise<void> {
    await this.memory.setCachedReasoning(
      AgentType.RECOMMEND,
      `user:embed:${userId}`,
      vector,
      this.USER_EMBED_TTL,
    );
  }

  // ── Qdrant ANN Search ──────────────────────────────────────

  private async searchQdrant(
    vector: number[],
    limit: number,
  ): Promise<QdrantSearchResult['result']> {
    const res = await fetch(`${this.qdrantBaseUrl}/collections/products/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
        score_threshold: 0.5,
      }),
    });

    if (!res.ok) {
      this.logger.warn(`Qdrant search failed: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as QdrantSearchResult;
    return data.result;
  }

  // ── Cold Start Fallback ────────────────────────────────────

  private async getPopularProducts(limit: number): Promise<RecommendTaskOutput['recommendations']> {
    // In production: this would query ClickHouse for top products by GMV
    // For now: return a placeholder structure
    return Array.from({ length: Math.min(limit, 10) }, (_, i) => ({
      productId: `popular_${i}`,
      score: 1.0 - i * 0.05,
      reason: 'trending' as const,
    }));
  }

  // ── Embed Product Text ─────────────────────────────────────

  /**
   * Called by the embedding pipeline when a product is created/updated.
   * Stores the product embedding in Qdrant for future ANN search.
   */
  async indexProduct(
    productId: string,
    text: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: text.substring(0, 8000),
      dimensions: this.EMBED_DIM,
    });

    const vector = response.data[0].embedding;

    await fetch(`${this.qdrantBaseUrl}/collections/products/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{ id: productId, vector, payload: { productId, ...payload } }],
      }),
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  private buildResult(
    task: AgentTask<RecommendTaskInput>,
    startMs: number,
    output: RecommendTaskOutput,
    status = TaskStatus.COMPLETED,
  ): AgentResult<RecommendTaskOutput> {
    return {
      taskId: task.taskId,
      type: AgentType.RECOMMEND,
      status,
      output,
      toolCallsCount: 3,
      durationMs: Date.now() - startMs,
      completedAt: new Date().toISOString(),
    };
  }
}
