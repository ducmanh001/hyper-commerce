// ============================================================
// HYPERCOMMERCE — Vector Memory Service
//
// Long-term semantic memory using Qdrant vector store.
// Stores and retrieves business knowledge, support FAQs,
// past agent decisions, and product knowledge base.
//
// Collections:
//   "agent_knowledge"  — product FAQs, policies, support docs
//   "past_decisions"   — historical agent reasoning (episodic)
//   "product_catalog"  — product embeddings for recommendations
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { createHash } from 'crypto';

export interface MemoryDocument {
  id: string;
  content: string;
  metadata: {
    source: string; // 'faq' | 'policy' | 'decision' | 'product'
    category?: string;
    tags?: string[];
    agentType?: string;
    userId?: string;
    createdAt: string;
  };
  score?: number; // similarity score (populated on search)
}

@Injectable()
export class VectorMemoryService implements OnModuleInit {
  private readonly logger = new Logger(VectorMemoryService.name);
  private openai: OpenAI;
  private qdrantBaseUrl: string;
  private readonly EMBEDDING_DIM = 768;
  private readonly COLLECTION_KNOWLEDGE = 'agent_knowledge';
  private readonly COLLECTION_DECISIONS = 'past_decisions';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
    });
    this.qdrantBaseUrl = this.config.get<string>('QDRANT_URL') ?? 'http://localhost:6333';
  }

  // ── Embedding ──────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: text.substring(0, 8000), // truncate to stay within limits
      dimensions: this.EMBEDDING_DIM,
    });
    return response.data[0].embedding;
  }

  /** Deterministic ID for deduplication */
  private contentId(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 32);
  }

  // ── Semantic Search ────────────────────────────────────────

  /**
   * Search the knowledge base for documents relevant to a query.
   * Uses cosine similarity; returns top-K results above threshold.
   */
  async search(
    query: string,
    collection: string = this.COLLECTION_KNOWLEDGE,
    limit = 5,
    scoreThreshold = 0.72,
  ): Promise<MemoryDocument[]> {
    const vector = await this.embed(query);

    const res = await fetch(`${this.qdrantBaseUrl}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector,
        limit,
        score_threshold: scoreThreshold,
        with_payload: true,
      }),
    });

    if (!res.ok) {
      this.logger.warn(`Qdrant search failed: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      result: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
    };

    return data.result.map((r) => ({
      id: r.id as string,
      content: r.payload['content'] as string,
      metadata: r.payload['metadata'] as MemoryDocument['metadata'],
      score: r.score,
    }));
  }

  // ── Store Knowledge ────────────────────────────────────────

  async storeDocument(
    content: string,
    metadata: MemoryDocument['metadata'],
    collection: string = this.COLLECTION_KNOWLEDGE,
  ): Promise<string> {
    const id = this.contentId(content);
    const vector = await this.embed(content);

    await fetch(`${this.qdrantBaseUrl}/collections/${collection}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{ id, vector, payload: { content, metadata } }],
      }),
    });

    return id;
  }

  /**
   * Store a past agent decision for future reference.
   * Enables agents to learn from history without re-running LLM.
   */
  async storeDecision(
    agentType: string,
    input: string,
    decision: string,
    outcome?: string,
  ): Promise<void> {
    const content = `Agent: ${agentType}\nInput: ${input}\nDecision: ${decision}${outcome ? `\nOutcome: ${outcome}` : ''}`;
    await this.storeDocument(
      content,
      {
        source: 'decision',
        agentType,
        createdAt: new Date().toISOString(),
      },
      this.COLLECTION_DECISIONS,
    );
  }

  // ── Ensure Collections Exist ───────────────────────────────

  async ensureCollections(): Promise<void> {
    const collections = [
      { name: this.COLLECTION_KNOWLEDGE, distance: 'Cosine' },
      { name: this.COLLECTION_DECISIONS, distance: 'Cosine' },
    ];

    for (const col of collections) {
      const res = await fetch(`${this.qdrantBaseUrl}/collections/${col.name}`);
      if (res.status === 404) {
        await fetch(`${this.qdrantBaseUrl}/collections/${col.name}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vectors: { size: this.EMBEDDING_DIM, distance: col.distance },
          }),
        });
        this.logger.log(`Created Qdrant collection: ${col.name}`);
      }
    }
  }
}
