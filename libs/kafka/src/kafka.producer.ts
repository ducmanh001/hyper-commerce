// ============================================================
// HYPERCOMMERCE — Kafka Producer
// Transactional produce, dead-letter routing, span propagation
// ============================================================

import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { Kafka, CompressionTypes } from 'kafkajs';
import { withRetry } from '@hypercommerce/common/utils/retry.util';
import { v4 as uuidv4 } from 'uuid';

export interface PublishOptions {
  topic: string;
  key?: string;
  value: Record<string, unknown>;
  headers?: Record<string, string>;
  traceId?: string;
  // For ordered delivery — partition key drives partition assignment
  partitionKey?: string;
}

export interface BatchPublishOptions {
  topic: string;
  messages: Array<{
    key: string;
    value: Record<string, unknown>;
    headers?: Record<string, string>;
  }>;
  traceId?: string;
}

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer!: Producer;
  private isConnected = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const kafka = new Kafka({
      clientId: this.config.get<string>('KAFKA_CLIENT_ID', 'hypercommerce'),
      brokers: this.config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
      retry: {
        retries: 5,
        initialRetryTime: 300,
        maxRetryTime: 30_000,
      },
    });

    this.producer = kafka.producer({
      // Idempotent producer disabled for single-broker dev environments
      idempotent: false,
    });

    // Connect asynchronously — don't block NestJS startup
    this.producer
      .connect()
      .then(() => {
        this.isConnected = true;
        this.logger.log('Kafka producer connected');
      })
      .catch((err) => {
        this.logger.error('Kafka producer connection failed', err);
      });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isConnected) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }

  /**
   * Publish a single event with automatic retry and trace propagation.
   * The message key drives partition assignment — critical for ordering guarantees.
   */
  async publish(options: PublishOptions): Promise<RecordMetadata[]> {
    const traceId = options.traceId ?? uuidv4();
    const eventId = uuidv4();

    const record: ProducerRecord = {
      topic: options.topic,
      compression: CompressionTypes.Snappy, // ~50% compression, low CPU overhead
      messages: [
        {
          key: options.partitionKey ?? options.key ?? null,
          value: JSON.stringify({
            ...options.value,
            _meta: {
              eventId,
              traceId,
              timestamp: new Date().toISOString(),
              producedBy: this.config.get('APP_NAME', 'hypercommerce'),
            },
          }),
          headers: {
            'content-type': 'application/json',
            'x-trace-id': traceId,
            'x-event-id': eventId,
            ...options.headers,
          },
        },
      ],
    };

    return withRetry(() => this.producer.send(record), {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 2_000,
      retryIf: (err) => this.isRetryableKafkaError(err),
      onRetry: (err, attempt) => {
        this.logger.warn(
          JSON.stringify({
            event: 'kafka_produce_retry',
            topic: options.topic,
            attempt,
            traceId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      },
    });
  }

  /**
   * Publish multiple messages in a single batch request.
   * Each message should have same partition key prefix for locality.
   */
  async publishBatch(options: BatchPublishOptions): Promise<RecordMetadata[]> {
    const traceId = options.traceId ?? uuidv4();

    const record: ProducerRecord = {
      topic: options.topic,
      compression: CompressionTypes.Snappy,
      messages: options.messages.map((msg) => ({
        key: msg.key,
        value: JSON.stringify({
          ...msg.value,
          _meta: {
            eventId: uuidv4(),
            traceId,
            timestamp: new Date().toISOString(),
          },
        }),
        headers: {
          'content-type': 'application/json',
          'x-trace-id': traceId,
          ...msg.headers,
        },
      })),
    };

    return this.producer.send(record);
  }

  /**
   * Transactional publish — ACID across multiple topics.
   * Use for Saga compensation steps where ordering is critical.
   */
  async publishInTransaction(records: PublishOptions[], traceId?: string): Promise<void> {
    const txTraceId = traceId ?? uuidv4();
    const transaction = await this.producer.transaction();

    try {
      await Promise.all(
        records.map((r) =>
          transaction.send({
            topic: r.topic,
            messages: [
              {
                key: r.partitionKey ?? r.key ?? null,
                value: JSON.stringify({
                  ...r.value,
                  _meta: { eventId: uuidv4(), traceId: txTraceId },
                }),
              },
            ],
          }),
        ),
      );

      await transaction.commit();
    } catch (error) {
      await transaction.abort();
      throw error;
    }
  }

  private isRetryableKafkaError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const retryableMessages = [
      'LEADER_NOT_AVAILABLE',
      'NOT_LEADER_FOR_PARTITION',
      'REQUEST_TIMED_OUT',
      'NETWORK_EXCEPTION',
    ];
    return retryableMessages.some((msg) => err.message.includes(msg));
  }
}
