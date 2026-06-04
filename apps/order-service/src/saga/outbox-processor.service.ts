// ============================================================
// HYPERCOMMERCE — Outbox Processor Service
//
// Polls the outbox_events table every 500ms and publishes
// PENDING events to Kafka. Marks events PROCESSED on success.
//
// Guarantees: at-least-once delivery (idempotent consumers handle dedup)
// Retry: exponential backoff (2^n seconds, max 5 attempts)
// ============================================================

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { LessThanOrEqual } from 'typeorm';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { OutboxEvent, OutboxEventStatus } from '../entities/outbox-event.entity';

@Injectable()
export class OutboxProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private timer: NodeJS.Timer | null = null;

  private readonly POLL_INTERVAL_MS = 500;
  private readonly BATCH_SIZE = 100;
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly kafka: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    // Start polling after a short delay to let other services initialize
    setTimeout(() => this.startPolling(), 2000);
    this.logger.log('Outbox processor started');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer as unknown as number);
  }

  private startPolling(): void {
    this.timer = setInterval(async () => {
      try {
        await this.processBatch();
      } catch (err) {
        this.logger.error('Outbox processor error', err);
      }
    }, this.POLL_INTERVAL_MS);
  }

  private async processBatch(): Promise<void> {
    // Fetch PENDING events that are due for processing
    const events = await this.outboxRepo.find({
      where: [
        { status: OutboxEventStatus.PENDING, processAfter: LessThanOrEqual(new Date()) },
        { status: OutboxEventStatus.PENDING, processAfter: undefined },
      ],
      order: { createdAt: 'ASC' },
      take: this.BATCH_SIZE,
    });

    if (events.length === 0) return;

    this.logger.debug(`Processing ${events.length} outbox events`);

    for (const event of events) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: OutboxEvent): Promise<void> {
    try {
      // Publish to Kafka
      await this.kafka.publish({
        topic: event.topic,
        partitionKey: event.partitionKey ?? event.aggregateId,
        value: event.payload,
      });

      // Mark as processed
      await this.outboxRepo.update(event.id, {
        status: OutboxEventStatus.PROCESSED,
        processedAt: new Date(),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newAttemptCount = event.attemptCount + 1;

      if (newAttemptCount >= this.MAX_ATTEMPTS) {
        // Move to FAILED — requires manual intervention
        await this.outboxRepo.update(event.id, {
          status: OutboxEventStatus.FAILED,
          attemptCount: newAttemptCount,
          lastError: errorMsg,
        });
        this.logger.error(
          `Outbox event ${event.id} permanently failed after ${newAttemptCount} attempts`,
          { topic: event.topic, aggregateId: event.aggregateId },
        );
      } else {
        // Exponential backoff: 2^attempt seconds (2s, 4s, 8s, 16s)
        const backoffSeconds = Math.pow(2, newAttemptCount);
        const processAfter = new Date(Date.now() + backoffSeconds * 1000);

        await this.outboxRepo.update(event.id, {
          attemptCount: newAttemptCount,
          lastError: errorMsg,
          processAfter,
        });

        this.logger.warn(
          `Outbox event ${event.id} failed attempt ${newAttemptCount}, retry in ${backoffSeconds}s`,
        );
      }
    }
  }

  /**
   * Replay FAILED events — called by admin endpoint for manual recovery.
   */
  async replayFailed(aggregateType?: string): Promise<number> {
    const where: Partial<OutboxEvent> = { status: OutboxEventStatus.FAILED };
    if (aggregateType) where.aggregateType = aggregateType;

    const result = await this.outboxRepo.update(where, {
      status: OutboxEventStatus.PENDING,
      attemptCount: 0,
      lastError: undefined,
      processAfter: new Date(),
    });

    this.logger.log(`Replaying ${result.affected ?? 0} failed outbox events`);
    return result.affected ?? 0;
  }
}
