// ============================================================
// HYPERCOMMERCE — Redis Memory Service
//
// Short-term memory layer for agents.
// Stores conversation context, task state, and cached reasoning.
//
// Key patterns:
//   agent:ctx:{agentType}:{sessionId}  — conversation history (TTL 24h)
//   agent:task:{taskId}               — task state (TTL 1h)
//   agent:cache:{agentType}:{key}     — reasoning cache (TTL varies)
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  tokensUsed?: number;
}

export interface AgentMemoryContext {
  sessionId: string;
  agentType: string;
  messages: ConversationMessage[];
  metadata: Record<string, unknown>;
  createdAt: string;
  lastUpdatedAt: string;
}

@Injectable()
export class RedisMemoryService implements OnModuleInit {
  private readonly logger = new Logger(RedisMemoryService.name);
  private redis: Redis;

  // TTL constants
  private readonly CONTEXT_TTL_SECONDS = 86400; // 24h
  private readonly TASK_TTL_SECONDS = 3600; // 1h
  private readonly CACHE_TTL_SECONDS = 300; // 5min
  private readonly MAX_MESSAGES_PER_SESSION = 20; // keep last 20 turns

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const url = new URL(redisUrl);

    this.redis = new Redis({
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => this.logger.error('Redis memory connection error', err));
  }

  // ── Conversation Context ────────────────────────────────────

  async getContext(agentType: string, sessionId: string): Promise<AgentMemoryContext | null> {
    const key = `agent:ctx:${agentType}:${sessionId}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as AgentMemoryContext;
  }

  async appendMessage(
    agentType: string,
    sessionId: string,
    message: ConversationMessage,
  ): Promise<void> {
    const key = `agent:ctx:${agentType}:${sessionId}`;
    const ctx = (await this.getContext(agentType, sessionId)) ?? {
      sessionId,
      agentType,
      messages: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };

    ctx.messages.push(message);

    // Rolling window — keep only last N messages to bound token usage
    if (ctx.messages.length > this.MAX_MESSAGES_PER_SESSION) {
      // Always keep the system message (index 0) + recent messages
      const systemMsg = ctx.messages.find((m) => m.role === 'system');
      const recent = ctx.messages.slice(-this.MAX_MESSAGES_PER_SESSION + 1);
      ctx.messages = systemMsg ? [systemMsg, ...recent] : recent;
    }

    ctx.lastUpdatedAt = new Date().toISOString();
    await this.redis.setex(key, this.CONTEXT_TTL_SECONDS, JSON.stringify(ctx));
  }

  async setContextMetadata(
    agentType: string,
    sessionId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const key = `agent:ctx:${agentType}:${sessionId}`;
    const ctx = await this.getContext(agentType, sessionId);
    if (ctx) {
      ctx.metadata = { ...ctx.metadata, ...metadata };
      ctx.lastUpdatedAt = new Date().toISOString();
      await this.redis.setex(key, this.CONTEXT_TTL_SECONDS, JSON.stringify(ctx));
    }
  }

  async clearContext(agentType: string, sessionId: string): Promise<void> {
    await this.redis.del(`agent:ctx:${agentType}:${sessionId}`);
  }

  // ── Task State ─────────────────────────────────────────────

  async saveTaskState(taskId: string, state: Record<string, unknown>): Promise<void> {
    const key = `agent:task:${taskId}`;
    await this.redis.setex(key, this.TASK_TTL_SECONDS, JSON.stringify(state));
  }

  async getTaskState(taskId: string): Promise<Record<string, unknown> | null> {
    const key = `agent:task:${taskId}`;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }

  // ── Reasoning Cache ────────────────────────────────────────

  /**
   * Cache agent reasoning results to avoid redundant LLM calls.
   * Key should be deterministic for the same input (hash of inputs).
   */
  async getCachedReasoning<T>(agentType: string, cacheKey: string): Promise<T | null> {
    const key = `agent:cache:${agentType}:${cacheKey}`;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setCachedReasoning<T>(
    agentType: string,
    cacheKey: string,
    value: T,
    ttlSeconds: number = this.CACHE_TTL_SECONDS,
  ): Promise<void> {
    const key = `agent:cache:${agentType}:${cacheKey}`;
    await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
  }

  // ── Fraud Score Cache ──────────────────────────────────────

  async getFraudScore(userId: string): Promise<number | null> {
    const val = await this.redis.get(`fraud:score:${userId}`);
    return val !== null ? parseFloat(val) : null;
  }

  async setFraudScore(userId: string, score: number, ttlSeconds = 3600): Promise<void> {
    await this.redis.setex(`fraud:score:${userId}`, ttlSeconds, score.toString());
  }

  async isFraudBlocked(userId: string): Promise<boolean> {
    return (await this.redis.exists(`fraud:block:${userId}`)) === 1;
  }

  async blockUser(userId: string, reason: string): Promise<void> {
    // No TTL — manual unblock required
    await this.redis.set(`fraud:block:${userId}`, reason);
  }
}
