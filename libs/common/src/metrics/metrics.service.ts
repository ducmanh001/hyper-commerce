// ============================================================
// HYPERCOMMERCE — Monitoring: Prometheus Metrics
// Custom business metrics beyond default HTTP metrics.
// Exported at /metrics endpoint for Prometheus scraping.
// ============================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry = new Registry();

  // ── Business Metrics ──────────────────────────────────────

  readonly ordersCreated = new Counter({
    name: 'hc_orders_created_total',
    help: 'Total orders created',
    labelNames: ['status', 'payment_method'],
    registers: [this.registry],
  });

  readonly paymentLatency = new Histogram({
    name: 'hc_payment_duration_seconds',
    help: 'Payment processing latency',
    labelNames: ['processor', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly activeStreamViewers = new Gauge({
    name: 'hc_active_stream_viewers',
    help: 'Current active livestream viewers across all streams',
    registers: [this.registry],
  });

  readonly flashSaleQueue = new Gauge({
    name: 'hc_flash_sale_queue_length',
    help: 'Flash sale queue depth',
    labelNames: ['sale_id'],
    registers: [this.registry],
  });

  readonly feedRankingLatency = new Histogram({
    name: 'hc_feed_ranking_duration_ms',
    help: 'Feed ranking pipeline latency',
    buckets: [5, 10, 25, 50, 100, 250, 500],
    registers: [this.registry],
  });

  readonly searchLatency = new Histogram({
    name: 'hc_search_duration_ms',
    help: 'Search query end-to-end latency',
    labelNames: ['search_type'],
    buckets: [10, 25, 50, 100, 250, 500, 1000],
    registers: [this.registry],
  });

  readonly kafkaPublishErrors = new Counter({
    name: 'hc_kafka_publish_errors_total',
    help: 'Kafka publish failures',
    labelNames: ['topic'],
    registers: [this.registry],
  });

  readonly inventoryConflicts = new Counter({
    name: 'hc_inventory_conflicts_total',
    help: 'Optimistic lock conflicts on inventory',
    labelNames: ['product_id'],
    registers: [this.registry],
  });

  readonly fraudBlocked = new Counter({
    name: 'hc_fraud_blocked_total',
    help: 'Orders blocked by fraud detection',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  readonly cacheHitRate = new Counter({
    name: 'hc_cache_hits_total',
    help: 'Cache hit/miss counters',
    labelNames: ['cache_layer', 'hit'],
    registers: [this.registry],
  });

  onModuleInit(): void {
    // Include default Node.js + process metrics
    collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
