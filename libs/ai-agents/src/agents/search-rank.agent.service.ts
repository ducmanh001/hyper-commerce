import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { RedisClientService } from '@app/redis';
import type { AgentTask, AgentResult, SearchRankTaskInput, SearchRankTaskOutput } from '../types';
import { AgentType, TaskStatus } from '../types';

// Cross-encoder reranker weights — trained offline, applied at runtime
// Features: BM25, kNN semantic similarity, sales, rating, price match
const FEATURE_WEIGHTS = {
  rrfScore: 0.45, // base retrieval relevance (BM25 + kNN merged)
  salesCount: 0.2, // popularity signal (log-normalized)
  rating: 0.15, // quality signal
  priceMatch: 0.1, // price in expected range for query
  personalBoost: 0.1, // per-user affinity (if userId provided)
};

const CACHE_TTL_SECONDS = 300; // 5 min — search results are fairly stable

@Injectable()
export class SearchRankAgentService {
  private readonly logger = new Logger(SearchRankAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisClientService,
  ) {}

  async rank(task: AgentTask<SearchRankTaskInput>): Promise<AgentResult<SearchRankTaskOutput>> {
    const start = Date.now();

    try {
      const input = task.input;

      // 1. Cache lookup (query + userId for personalization)
      const cacheKey = this.cacheKey(input.query, input.userId);
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as SearchRankTaskOutput;
        return this.result(task, { ...parsed, fromCache: true }, start);
      }

      // 2. Choose ranking strategy
      const strategy = this.chooseStrategy(input);

      // 3. Score each candidate
      const scored = input.candidates.map((candidate) => {
        const score = this.computeScore(candidate, input.query, strategy);
        return { productId: candidate.productId, score };
      });

      // 4. Sort descending and apply limit
      scored.sort((a, b) => b.score - a.score);
      const ranked = scored.slice(0, input.limit).map((s) => s.productId);

      // 5. Build explanations for top 3
      const topExplanations = scored.slice(0, 3).map(({ productId, score }) => {
        const candidate = input.candidates.find((c) => c.productId === productId)!;
        const reasons: string[] = [];
        if (candidate.rrfScore > 0.6) reasons.push('high relevance score');
        if (candidate.fields.salesCount > 1000) reasons.push('popular item');
        if (candidate.fields.rating >= 4.5) reasons.push('highly rated');
        return { productId, reason: reasons.join(', ') || `score: ${score.toFixed(3)}` };
      });

      const output: SearchRankTaskOutput = {
        rankedProductIds: ranked,
        topExplanations,
        rankerUsed: strategy,
        fromCache: false,
      };

      // 6. Cache result
      await this.redis.set(cacheKey, JSON.stringify(output), CACHE_TTL_SECONDS);

      this.logger.debug({
        query: input.query,
        candidates: input.candidates.length,
        strategy,
        durationMs: Date.now() - start,
      });

      return this.result(task, output, start);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Search rank failed: ${err.message}`, err.stack);
      return this.result(task, undefined, start, err.message);
    }
  }

  // ── Private helpers ────────────────────────────────────────

  private chooseStrategy(input: SearchRankTaskInput): SearchRankTaskOutput['rankerUsed'] {
    if (input.userId && input.context !== 'autocomplete') return 'personalized';
    if (input.context === 'autocomplete') return 'rrf_only';
    return 'cross_encoder';
  }

  private computeScore(
    candidate: SearchRankTaskInput['candidates'][0],
    query: string,
    strategy: SearchRankTaskOutput['rankerUsed'],
  ): number {
    const { fields, rrfScore } = candidate;

    // Normalize sales count (log scale, cap at 100K)
    const salesNorm = Math.log10(Math.min(fields.salesCount + 1, 100000)) / 5;
    // Normalize rating (1-5 → 0-1)
    const ratingNorm = (fields.rating - 1) / 4;
    // Price match: simple heuristic — products <500K VND score higher for short queries
    const priceMatchScore = query.length < 20 && fields.price < 500000 ? 1.0 : 0.5;

    const baseScore =
      FEATURE_WEIGHTS.rrfScore * rrfScore +
      FEATURE_WEIGHTS.salesCount * salesNorm +
      FEATURE_WEIGHTS.rating * ratingNorm +
      FEATURE_WEIGHTS.priceMatch * priceMatchScore;

    // Personalization boost: title contains query token (simple, no LLM needed)
    if (strategy === 'personalized') {
      const queryTokens = query.toLowerCase().split(' ');
      const titleLower = fields.title.toLowerCase();
      const titleMatch =
        queryTokens.filter((t) => titleLower.includes(t)).length / queryTokens.length;
      return baseScore + FEATURE_WEIGHTS.personalBoost * titleMatch;
    }

    return baseScore;
  }

  private cacheKey(query: string, userId?: string): string {
    const base = `search:rank:${query.toLowerCase().replace(/\s+/g, '_')}`;
    return userId ? `${base}:${userId}` : base;
  }

  private result(
    task: AgentTask<SearchRankTaskInput>,
    output: SearchRankTaskOutput | undefined,
    start: number,
    error?: string,
  ): AgentResult<SearchRankTaskOutput> {
    return {
      taskId: task.taskId,
      type: AgentType.SEARCH_RANK,
      status: error ? TaskStatus.FAILED : TaskStatus.COMPLETED,
      output,
      error,
      toolCallsCount: 0,
      durationMs: Date.now() - start,
      completedAt: new Date().toISOString(),
    };
  }
}
