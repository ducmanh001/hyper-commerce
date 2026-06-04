// ============================================================
// HYPERCOMMERCE — Analytics Event Collector Service
// High-throughput event ingestion: Kafka → ClickHouse.
// Pattern: batch micro-buffering + bulk insert.
//
// Tại sao ClickHouse thay vì PostgreSQL?
// - Columnar storage → OLAP queries 100-1000x faster
// - ZSTD compression → 10x storage reduction
// - Native materialized views → real-time aggregations
// - Vector functions → user behavior embeddings
//
// Insert throughput target: 1M events/second sustained
// ============================================================

import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { ClickHouseService } from './clickhouse/clickhouse.service';

export interface AnalyticsEvent {
  eventId: string;
  eventType: string;
  userId?: string;
  sessionId?: string;
  streamId?: string;
  productId?: string;
  orderId?: string;
  searchQuery?: string;
  properties: Record<string, unknown>;
  timestamp: string; // ISO 8601
  appVersion?: string;
  platform?: 'IOS' | 'ANDROID' | 'WEB';
  countryCode?: string;
  regionCode?: string;
}

@Injectable()
export class EventCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventCollectorService.name);

  // Micro-buffer: accumulate events before bulk insert
  private buffer: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  // Flush config
  private readonly FLUSH_SIZE = 5000; // Flush when buffer reaches 5K events
  private readonly FLUSH_INTERVAL_MS = 1000; // Or every 1 second — whichever comes first

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly clickhouse: ClickHouseService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Start flush interval
    this.flushInterval = setInterval(() => {
      void this.flush();
    }, this.FLUSH_INTERVAL_MS);

    // Subscribe to analytics events topic
    await this.consumer.registerConsumer({
      groupId: 'analytics-collector',
      topics: [
        APP_CONSTANTS.KAFKA_TOPICS.ANALYTICS_EVENTS,
        APP_CONSTANTS.KAFKA_TOPICS.ORDER_CONFIRMED,
        APP_CONSTANTS.KAFKA_TOPICS.LIVE_EVENTS,
      ],
      handlers: [
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ANALYTICS_EVENTS,
          handle: this.onAnalyticsEvent.bind(this),
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CONFIRMED,
          handle: this.onOrderEvent.bind(this),
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.LIVE_EVENTS,
          handle: this.onLiveEvent.bind(this),
        },
      ],
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    // Flush remaining events on shutdown
    await this.flush();
  }

  private async onAnalyticsEvent(
    event: Record<string, unknown>,
    _meta: MessageMetadata,
  ): Promise<void> {
    this.addToBuffer(event as unknown as AnalyticsEvent);
  }

  private async onOrderEvent(
    event: Record<string, unknown>,
    _meta: MessageMetadata,
  ): Promise<void> {
    if (event.type !== 'ORDER_CONFIRMED') return;

    // Normalize to analytics event
    this.addToBuffer({
      eventId: `order_${event.orderId}_confirmed`,
      eventType: 'PURCHASE',
      userId: event.userId as string,
      orderId: event.orderId as string,
      properties: {
        totalAmount: event.totalAmount,
        currency: event.currency,
        itemCount: event.itemCount,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async onLiveEvent(event: Record<string, unknown>, _meta: MessageMetadata): Promise<void> {
    this.addToBuffer({
      eventId: String(event.id ?? `live_${Date.now()}`),
      eventType: event.type as string,
      userId: event.userId as string,
      streamId: event.streamId as string,
      properties: event as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    });
  }

  private addToBuffer(event: AnalyticsEvent): void {
    this.buffer.push(event);

    if (this.buffer.length >= this.FLUSH_SIZE) {
      void this.flush();
    }
  }

  /**
   * Bulk insert buffered events to ClickHouse.
   *
   * Double-buffer pattern: swap current buffer with empty array
   * immediately → new events buffer while we flush old ones.
   * Prevents locking under high throughput.
   */
  private async flush(): Promise<void> {
    if (!this.buffer.length) return;

    // Atomic swap — no lock needed in single-threaded Node.js
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.clickhouse.insertBatch('events', batch);

      this.logger.log(
        JSON.stringify({
          event: 'analytics_flush',
          batchSize: batch.length,
        }),
      );
    } catch (error) {
      // Re-queue failed events (simplified — in production: DLQ or local retry)
      this.buffer = [...batch, ...this.buffer];
      this.logger.error(
        JSON.stringify({
          event: 'analytics_flush_failed',
          batchSize: batch.length,
          error: error instanceof Error ? error.message : 'Unknown',
        }),
      );
    }
  }
}
