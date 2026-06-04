// ============================================================
// HYPERCOMMERCE — Episodic Memory Service
//
// Records what each agent has done in past sessions.
// Enables learning from past interactions and avoiding
// repeated mistakes. Backed by Redis (recent) + Qdrant (long-term).
// ============================================================

import { Injectable } from '@nestjs/common';
import type { RedisMemoryService } from './redis-memory.service';
import type { VectorMemoryService } from './vector-memory.service';

export interface AgentEpisode {
  episodeId: string;
  agentType: string;
  userId?: string;
  summary: string;
  inputHash: string;
  outcome: 'success' | 'failure' | 'escalated';
  learnings?: string;
  createdAt: string;
}

@Injectable()
export class EpisodicMemoryService {
  constructor(
    private readonly redis: RedisMemoryService,
    private readonly vector: VectorMemoryService,
  ) {}

  /**
   * Record what happened in an agent session.
   * Recent episodes stored in Redis (fast lookup).
   * All episodes vectorized into Qdrant (semantic search).
   */
  async recordEpisode(episode: Omit<AgentEpisode, 'episodeId'>): Promise<string> {
    const episodeId = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const full: AgentEpisode = { ...episode, episodeId };

    // Store in Redis for quick recent lookup
    await this.redis.setCachedReasoning(
      episode.agentType,
      `episode:${episodeId}`,
      full,
      86400 * 7, // 7 days in Redis
    );

    // Vectorize and store in Qdrant for semantic similarity search
    const content = `${episode.summary}${episode.learnings ? ` Learnings: ${episode.learnings}` : ''}`;
    await this.vector.storeDecision(
      episode.agentType,
      episode.summary,
      episode.outcome,
      episode.learnings,
    );

    return episodeId;
  }

  /**
   * Find similar past episodes to inform current agent decision.
   * Reduces LLM calls by reusing past reasoning.
   */
  async findSimilarEpisodes(
    agentType: string,
    currentSituation: string,
    limit = 3,
  ): Promise<AgentEpisode[]> {
    const docs = await this.vector.search(
      `Agent: ${agentType} ${currentSituation}`,
      'past_decisions',
      limit,
      0.8,
    );

    return docs.map((d) => ({
      episodeId: d.id,
      agentType,
      summary: d.content,
      inputHash: '',
      outcome: 'success' as const,
      createdAt: d.metadata.createdAt,
    }));
  }
}
