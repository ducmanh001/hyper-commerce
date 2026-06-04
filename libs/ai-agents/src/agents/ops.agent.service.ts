// ============================================================
// HYPERCOMMERCE — Ops Agent Service
//
// Monitors system health and responds to alerts.
// Analyzes Prometheus/Grafana alerts and suggests runbook actions.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { AgentTask, AgentResult, OpsTaskInput, OpsTaskOutput } from '../types';
import { AgentType, TaskStatus } from '../types';
import type { VectorMemoryService } from '../memory/vector-memory.service';

@Injectable()
export class OpsAgentService {
  private readonly logger = new Logger(OpsAgentService.name);

  constructor(private readonly vectorMemory: VectorMemoryService) {}

  async analyze(task: AgentTask<OpsTaskInput>): Promise<AgentResult<OpsTaskOutput>> {
    const start = Date.now();
    const { input } = task;

    const analysis = this.analyzeAlert(input.alertName ?? '', input.context ?? {});

    return {
      taskId: task.taskId,
      type: AgentType.OPS,
      status: TaskStatus.COMPLETED,
      output: analysis,
      toolCallsCount: 1,
      durationMs: Date.now() - start,
      completedAt: new Date().toISOString(),
    };
  }

  private analyzeAlert(alertName: string, context: Record<string, unknown>): OpsTaskOutput {
    const runbooks: Record<string, OpsTaskOutput> = {
      GMVDrop30Percent: {
        analysis:
          'GMV dropped >30% vs 24h baseline. Check: payment service health, Kafka consumer lag, order-service errors.',
        actions: [
          'Check payment-service /health endpoint',
          'Inspect Kafka consumer group lag for order.created topic',
          'Review order-service error rate in Grafana',
          'Check if flash sale ended (expected GMV drop)',
        ],
        runbookUrl: '/runbooks/gmv-drop',
        autoResolved: false,
      },
      KafkaConsumerLag: {
        analysis: `Kafka consumer lag detected. Topic: ${context['topic'] ?? 'unknown'}. Consumers may be down or slow.`,
        actions: [
          'Check consumer group status: kafka-consumer-groups.sh --describe',
          'Restart stuck consumer pods if lag > 10000',
          'Verify no message deserialization errors in logs',
          'Scale up consumer replicas if sustained lag',
        ],
        runbookUrl: '/runbooks/kafka-lag',
        autoResolved: false,
      },
      FraudSpike: {
        analysis:
          'Fraud detection spike >50 blocks/5min. Possible attack wave or false positive surge.',
        actions: [
          'Check fraud:score:* keys in Redis for distribution',
          'Review recent blocked orders in admin dashboard',
          'Check if new IP range is triggering geo rule',
          'Lower ML threshold temporarily if false positives suspected',
        ],
        runbookUrl: '/runbooks/fraud-spike',
        autoResolved: false,
      },
      RedisMemory90Percent: {
        analysis:
          'Redis memory at 90% (>460MB of 512MB). Risk of key eviction causing cache misses.',
        actions: [
          'Run MEMORY DOCTOR in redis-cli for analysis',
          'Check for keys without TTL: SCAN 0 COUNT 100',
          'Identify largest keys: MEMORY USAGE <key>',
          'Consider increasing maxmemory or purging stale sessions',
        ],
        runbookUrl: '/runbooks/redis-memory',
        autoResolved: false,
      },
    };

    return (
      runbooks[alertName] ?? {
        analysis: `Unknown alert: ${alertName}. Manual investigation required.`,
        actions: [
          'Check service logs',
          'Review Grafana dashboards',
          'Escalate to on-call engineer',
        ],
        autoResolved: false,
      }
    );
  }
}
