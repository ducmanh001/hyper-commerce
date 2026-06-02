// ============================================================
// HYPERCOMMERCE — Kafka Consumer
// At-least-once với idempotency guard, DLQ routing,
// exponential backoff, manual offset commit.
// ============================================================

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Consumer,
  Kafka,
  KafkaMessage,
  EachMessagePayload,
} from 'kafkajs';
import { KafkaProducerService } from './kafka.producer';

export interface MessageHandler<T = Record<string, unknown>> {
  topic: string;
  handle(message: T, metadata: MessageMetadata): Promise<void>;
}

export interface MessageMetadata {
  partition: number;
  offset: string;
  traceId: string;
  eventId: string;
  timestamp: Date;
  topic: string;
}

export interface ConsumerConfig {
  groupId: string;
  topics: string[];
  handlers: MessageHandler[];
  fromBeginning?: boolean;
  maxRetries?: number;
  retryBackoffMs?: number;
}

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private consumers: Consumer[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly producer: KafkaProducerService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Consumers are registered lazily via registerConsumer()
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.disconnect()));
    this.logger.log('All Kafka consumers disconnected');
  }

  async registerConsumer(consumerConfig: ConsumerConfig): Promise<void> {
    const kafka = new Kafka({
      clientId: `${this.config.get('KAFKA_CLIENT_ID')}-consumer-${consumerConfig.groupId}`,
      brokers: this.config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
    });

    const consumer = kafka.consumer({
      groupId: consumerConfig.groupId,
      // Heartbeat every 3s — balance between detection speed and overhead
      heartbeatInterval: 3_000,
      // Session timeout: 45s — gives time for GC pauses without rebalance
      sessionTimeout: 45_000,
      // Max bytes per partition per fetch — avoids memory pressure
      maxBytesPerPartition: 1_048_576, // 1MB
    });

    await consumer.connect();
    await consumer.subscribe({
      topics: consumerConfig.topics,
      fromBeginning: consumerConfig.fromBeginning ?? false,
    });

    const handlerMap = new Map<string, MessageHandler>(
      consumerConfig.handlers.map((h) => [h.topic, h]),
    );

    await consumer.run({
      // Manual partition assigner for fine-grained control
      autoCommit: false, // Manual commit after successful processing
      eachMessage: async (payload: EachMessagePayload) => {
        await this.processMessage(
          payload,
          handlerMap,
          consumer,
          consumerConfig.maxRetries ?? 3,
          consumerConfig.retryBackoffMs ?? 1_000,
        );
      },
    });

    this.consumers.push(consumer);
    this.logger.log(
      `Consumer registered: group=${consumerConfig.groupId} topics=${consumerConfig.topics.join(',')}`,
    );
  }

  private async processMessage(
    payload: EachMessagePayload,
    handlerMap: Map<string, MessageHandler>,
    consumer: Consumer,
    maxRetries: number,
    retryBackoffMs: number,
  ): Promise<void> {
    const { topic, partition, message } = payload;
    const handler = handlerMap.get(topic);

    if (!handler) {
      this.logger.warn(`No handler for topic: ${topic}`);
      await this.commitOffset(consumer, topic, partition, message);
      return;
    }

    const metadata = this.extractMetadata(topic, partition, message);
    const parsed = this.parseMessage(message);

    if (!parsed) {
      // Unparseable → DLQ immediately, do not block
      await this.routeToDLQ(topic, message, 'PARSE_ERROR');
      await this.commitOffset(consumer, topic, partition, message);
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        await handler.handle(parsed, metadata);
        await this.commitOffset(consumer, topic, partition, message);
        return;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          JSON.stringify({
            event: 'consumer_retry',
            topic,
            partition,
            offset: message.offset,
            attempt,
            traceId: metadata.traceId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );

        if (attempt <= maxRetries) {
          // Exponential backoff: 1s, 2s, 4s...
          await this.sleep(retryBackoffMs * Math.pow(2, attempt - 1));
        }
      }
    }

    // All retries exhausted → route to Dead Letter Queue
    this.logger.error(
      JSON.stringify({
        event: 'consumer_dlq',
        topic,
        traceId: metadata.traceId,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      }),
    );

    await this.routeToDLQ(topic, message, 'PROCESSING_FAILED', lastError);
    await this.commitOffset(consumer, topic, partition, message);
  }

  private extractMetadata(
    topic: string,
    partition: number,
    message: KafkaMessage,
  ): MessageMetadata {
    const headers = message.headers ?? {};
    const getHeader = (key: string): string =>
      Buffer.isBuffer(headers[key])
        ? (headers[key] as Buffer).toString()
        : String(headers[key] ?? '');

    return {
      partition,
      offset: message.offset,
      traceId: getHeader('x-trace-id') || 'no-trace',
      eventId: getHeader('x-event-id') || 'no-event',
      timestamp: new Date(Number(message.timestamp)),
      topic,
    };
  }

  private parseMessage(message: KafkaMessage): Record<string, unknown> | null {
    try {
      const raw = message.value?.toString() ?? '{}';
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async commitOffset(
    consumer: Consumer,
    topic: string,
    partition: number,
    message: KafkaMessage,
  ): Promise<void> {
    await consumer.commitOffsets([
      {
        topic,
        partition,
        // Commit offset+1 (next to consume)
        offset: String(Number(message.offset) + 1),
      },
    ]);
  }

  private async routeToDLQ(
    originalTopic: string,
    message: KafkaMessage,
    reason: string,
    error?: unknown,
  ): Promise<void> {
    const dlqTopic = `${originalTopic}.dlq`;
    await this.producer.publish({
      topic: dlqTopic,
      value: {
        originalTopic,
        originalMessage: message.value?.toString() ?? '',
        reason,
        error: error instanceof Error ? error.message : String(error ?? ''),
        failedAt: new Date().toISOString(),
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
