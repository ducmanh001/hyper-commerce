// ============================================================
// HYPERCOMMERCE — Orchestrator Service
//
// Routes incoming agent tasks to the correct specialized agent.
// Implements priority queue ordering:
//   CRITICAL (0) → FRAUD checks (block before order completes)
//   HIGH     (1) → RECOMMENDATIONS (real-time feed)
//   NORMAL   (2) → SUPPORT responses
//   LOW      (3) → Background analytics/ops
//
// Task routing is deterministic by AgentType.
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentTask,
  AgentResult,
  FraudTaskInput,
  FraudTaskOutput,
  RecommendTaskInput,
  RecommendTaskOutput,
  SupportTaskInput,
  SupportTaskOutput,
} from '../types';
import { AgentType, TaskPriority } from '../types';
import type { FraudAgentService } from '../agents/fraud.agent.service';
import type { RecommendAgentService } from '../agents/recommend.agent.service';
import type { SupportAgentService } from '../agents/support.agent.service';

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly fraud: FraudAgentService,
    private readonly recommend: RecommendAgentService,
    private readonly support: SupportAgentService,
  ) {}

  onModuleInit() {
    this.logger.log('AI Agent Orchestrator initialized');
  }

  // ── Public API ─────────────────────────────────────────────

  async checkFraud(
    input: FraudTaskInput,
    correlationId: string,
  ): Promise<AgentResult<FraudTaskOutput>> {
    const task = this.createTask<FraudTaskInput>(
      AgentType.FRAUD,
      TaskPriority.CRITICAL,
      input,
      correlationId,
      500, // 500ms max — must not block checkout significantly
    );
    return this.fraud.evaluate(task);
  }

  async getRecommendations(
    input: RecommendTaskInput,
    correlationId: string,
  ): Promise<AgentResult<RecommendTaskOutput>> {
    const task = this.createTask<RecommendTaskInput>(
      AgentType.RECOMMEND,
      TaskPriority.HIGH,
      input,
      correlationId,
      200, // 200ms max — must feel instant
    );
    return this.recommend.recommend(task);
  }

  async handleSupportMessage(
    input: SupportTaskInput,
    correlationId: string,
  ): Promise<AgentResult<SupportTaskOutput>> {
    const task = this.createTask<SupportTaskInput>(
      AgentType.SUPPORT,
      TaskPriority.NORMAL,
      input,
      correlationId,
      10000, // 10s max — LLM can take longer
    );
    return this.support.respond(task);
  }

  // ── Factory ────────────────────────────────────────────────

  private createTask<T>(
    type: AgentType,
    priority: TaskPriority,
    input: T,
    correlationId: string,
    timeoutMs: number,
  ): AgentTask<T> {
    return {
      taskId: uuidv4(),
      type,
      priority,
      input,
      correlationId,
      createdAt: new Date().toISOString(),
      timeoutMs,
      retryCount: 0,
    };
  }
}
