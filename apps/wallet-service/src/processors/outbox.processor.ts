// ============================================================
// OutboxProcessor
// Polls wallet_outbox_events for PENDING rows and publishes
// them to Kafka, then marks them PROCESSED.
// Runs every 2 seconds via a scheduled interval.
// ============================================================

import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { WalletOutboxEvent } from '../entities/wallet-outbox.entity';

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly kafka: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processOutbox(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async processOutbox(): Promise<void> {
    const manager = this.dataSource.manager;

    let pending: WalletOutboxEvent[];
    try {
      pending = await manager.find(WalletOutboxEvent, {
        where: { status: 'PENDING' },
        order: { createdAt: 'ASC' },
        take: BATCH_SIZE,
      });
    } catch (err) {
      this.logger.warn('Outbox poll failed', err);
      return;
    }

    for (const event of pending) {
      try {
        await this.kafka.publish({
          topic: event.topic,
          partitionKey: event.partitionKey,
          value: event.payload,
        });

        await manager.update(WalletOutboxEvent, event.id, {
          status: 'PROCESSED',
          processedAt: new Date(),
        });
      } catch (err) {
        const nextAttempt = (event.attemptCount ?? 0) + 1;
        const nextStatus = nextAttempt >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';

        await manager
          .update(WalletOutboxEvent, event.id, {
            attemptCount: nextAttempt,
            status: nextStatus,
          })
          .catch(() => {});

        this.logger.error(`Outbox publish failed (attempt ${nextAttempt})`, err);
      }
    }
  }
}
