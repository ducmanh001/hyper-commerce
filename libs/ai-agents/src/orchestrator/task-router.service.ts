// ============================================================
// HYPERCOMMERCE — Task Router Service
//
// Routes Kafka agent.task messages to the correct agent.
// Implements task deduplication and retry logic.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { AgentTask } from '../types';
import { AgentType } from '../types';
import type { OrchestratorService } from './orchestrator.service';
import type { FraudTaskInput, RecommendTaskInput, SupportTaskInput } from '../types';

@Injectable()
export class TaskRouterService {
  private readonly logger = new Logger(TaskRouterService.name);

  constructor(private readonly orchestrator: OrchestratorService) {}

  async route(task: AgentTask): Promise<void> {
    this.logger.debug(`Routing task ${task.taskId} → ${task.type}`);

    switch (task.type) {
      case AgentType.FRAUD:
        await this.orchestrator.checkFraud(task.input as FraudTaskInput, task.correlationId);
        break;

      case AgentType.RECOMMEND:
        await this.orchestrator.getRecommendations(
          task.input as RecommendTaskInput,
          task.correlationId,
        );
        break;

      case AgentType.SUPPORT:
        await this.orchestrator.handleSupportMessage(
          task.input as SupportTaskInput,
          task.correlationId,
        );
        break;

      default:
        this.logger.warn(`Unknown agent type: ${task.type}`);
    }
  }
}
