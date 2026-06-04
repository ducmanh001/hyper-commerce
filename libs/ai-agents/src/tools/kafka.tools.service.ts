// ============================================================
// HYPERCOMMERCE — Tools: Kafka Tools
//
// Typed wrappers for publishing agent events to Kafka.
// Agents should use these tools to publish results rather
// than calling KafkaProducerService directly.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Producer } from 'kafkajs';
import { Kafka } from 'kafkajs';
import type { AgentResult } from '../types';
import { AgentType } from '../types';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class KafkaToolsService {
  private readonly logger = new Logger(KafkaToolsService.name);
  private producer: Producer;

  constructor(private readonly config: ConfigService) {
    const kafka = new Kafka({
      clientId: 'ai-agents',
      brokers: (config.get<string>('KAFKA_BROKERS') ?? 'localhost:9092').split(','),
    });
    this.producer = kafka.producer({ idempotent: true });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  /** Publish agent result for downstream consumers */
  async publishAgentResult(result: AgentResult, correlationId: string): Promise<void> {
    const topic = result.type === AgentType.FRAUD ? 'fraud.detected' : 'agent.result';

    await this.producer.send({
      topic,
      messages: [
        {
          key: result.taskId,
          value: JSON.stringify({
            eventId: uuidv4(),
            correlationId,
            timestamp: new Date().toISOString(),
            version: 1,
            source: 'ai-agents',
            payload: result,
          }),
        },
      ],
    });
  }

  /** Publish a task for async agent processing */
  async publishAgentTask(
    agentType: AgentType,
    input: unknown,
    correlationId: string,
    priority = 2,
  ): Promise<string> {
    const taskId = uuidv4();

    await this.producer.send({
      topic: 'agent.task',
      messages: [
        {
          key: taskId,
          value: JSON.stringify({
            eventId: uuidv4(),
            correlationId,
            timestamp: new Date().toISOString(),
            version: 1,
            source: 'orchestrator',
            payload: {
              taskId,
              type: agentType,
              priority,
              input,
              correlationId,
              createdAt: new Date().toISOString(),
              timeoutMs: 30000,
              retryCount: 0,
            },
          }),
        },
      ],
    });

    return taskId;
  }
}
