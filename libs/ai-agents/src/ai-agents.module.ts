// ============================================================
// HYPERCOMMERCE — AI Agents Module
//
// Multi-agent operating system for both development workflow
// and runtime business operations.
//
// Architecture: Hierarchical Multi-Agent + Memory-Augmented
//
// Orchestrator (routes tasks by domain)
//   ├── FraudAgent          (real-time fraud detection pipeline)
//   ├── RecommendAgent      (personalized recommendations)
//   ├── SupportAgent        (customer support automation)
//   ├── OpsAgent            (system health monitoring)
//   ├── ModerationAgent     (content safety — GPT-4o-mini)
//   └── SearchRankAgent     (search result reranking — no LLM)
//
// Memory Layers:
//   - Redis: short-term context (conversation, task state)
//   - Qdrant: long-term semantic memory (business knowledge)
//   - Kafka: agent-to-agent async communication
// ============================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { TaskRouterService } from './orchestrator/task-router.service';
import { FraudAgentService } from './agents/fraud.agent.service';
import { RecommendAgentService } from './agents/recommend.agent.service';
import { SupportAgentService } from './agents/support.agent.service';
import { OpsAgentService } from './agents/ops.agent.service';
import { ContentModerationAgentService } from './agents/moderation.agent.service';
import { SearchRankAgentService } from './agents/search-rank.agent.service';
import { RedisMemoryService } from './memory/redis-memory.service';
import { VectorMemoryService } from './memory/vector-memory.service';
import { EpisodicMemoryService } from './memory/episodic-memory.service';
import { DatabaseToolsService } from './tools/database.tools.service';
import { KafkaToolsService } from './tools/kafka.tools.service';
import { ServiceCallToolsService } from './tools/service-call.tools.service';

@Module({
  imports: [ConfigModule],
  providers: [
    // Orchestration
    OrchestratorService,
    TaskRouterService,
    // Domain agents
    FraudAgentService,
    RecommendAgentService,
    SupportAgentService,
    OpsAgentService,
    ContentModerationAgentService,
    SearchRankAgentService,
    // Memory layer
    RedisMemoryService,
    VectorMemoryService,
    EpisodicMemoryService,
    // Tools
    DatabaseToolsService,
    KafkaToolsService,
    ServiceCallToolsService,
  ],
  exports: [
    OrchestratorService,
    FraudAgentService,
    RecommendAgentService,
    SupportAgentService,
    ContentModerationAgentService,
    SearchRankAgentService,
  ],
})
export class AiAgentsModule {}
