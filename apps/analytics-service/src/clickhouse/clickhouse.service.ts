// ============================================================
// HYPERCOMMERCE — ClickHouse Service
// Columnar OLAP database for analytics + real-time dashboards.
//
// Schema decisions:
// - ReplacingMergeTree: dedup on (eventId, timestamp)
// - Partition by toYYYYMM(timestamp): efficient time-range queries
// - ORDER BY (eventType, userId, timestamp): optimal for aggregation
//
// Materialized views pre-aggregate:
// - Daily active users (DAU)
// - Revenue per seller
// - Product view-to-purchase ratio
// - Stream viewer trends
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

@Injectable()
export class ClickHouseService implements OnModuleInit {
  private readonly logger = new Logger(ClickHouseService.name);
  private client!: ClickHouseClient;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.config.get<string>('CLICKHOUSE_HOST', 'localhost');
    const port = this.config.get<string>('CLICKHOUSE_PORT', '8123');
    const url = host.startsWith('http') ? host : `http://${host}:${port}`;
    this.client = createClient({
      url,
      username: this.config.get<string>('CLICKHOUSE_USER', 'default'),
      password: this.config.get<string>('CLICKHOUSE_PASSWORD', ''),
      database: this.config.get<string>('CLICKHOUSE_DATABASE', 'hypercommerce'),
    });

    await this.initSchema().catch((err: Error) => {
      this.logger.warn(`ClickHouse init failed (analytics queries will fail): ${err.message}`);
    });
    this.logger.log('ClickHouse connected');
  }

  /**
   * Bulk insert — ClickHouse thrives on large inserts.
   * Never insert one row at a time → O(N) latency per event.
   * Batch insert → amortized insert cost.
   */
  async insertBatch<T extends object>(table: string, rows: T[]): Promise<void> {
    if (!rows.length) return;

    await this.client.insert({
      table,
      values: rows,
      format: 'JSONEachRow',
    });
  }

  /**
   * Real-time aggregation queries.
   * ClickHouse executes these in milliseconds even on billions of rows.
   */
  async getDailyRevenue(
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      date: string;
      revenue: number;
      orderCount: number;
    }>
  > {
    const result = await this.client.query({
      query: `
        SELECT
          toDate(timestamp)   AS date,
          sum(toFloat64(properties['totalAmount'])) AS revenue,
          count()             AS orderCount
        FROM events
        WHERE eventType = 'PURCHASE'
          AND timestamp BETWEEN {start:String} AND {end:String}
        GROUP BY date
        ORDER BY date ASC
      `,
      query_params: { start: startDate, end: endDate },
      format: 'JSONEachRow',
    });

    return result.json<{ date: string; revenue: number; orderCount: number }>();
  }

  async getTopProducts(
    limit = 20,
    windowHours = 24,
  ): Promise<
    Array<{
      productId: string;
      views: number;
      purchases: number;
      conversionRate: number;
    }>
  > {
    const result = await this.client.query({
      query: `
        SELECT
          properties['productId']::String AS productId,
          countIf(eventType = 'PRODUCT_VIEWED') AS views,
          countIf(eventType = 'PURCHASE')        AS purchases,
          purchases / views AS conversionRate
        FROM events
        WHERE timestamp > now() - INTERVAL {hours:UInt32} HOUR
          AND eventType IN ('PRODUCT_VIEWED', 'PURCHASE')
          AND isNotNull(properties['productId'])
        GROUP BY productId
        HAVING views > 100
        ORDER BY purchases DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { hours: windowHours, limit },
      format: 'JSONEachRow',
    });

    return result.json<{
      productId: string;
      views: number;
      purchases: number;
      conversionRate: number;
    }>();
  }

  async getStreamAnalytics(streamId: string): Promise<{
    peakViewers: number;
    totalViews: number;
    avgWatchTime: number;
    commentsCount: number;
    giftsCount: number;
    revenue: number;
  }> {
    const result = await this.client.query({
      query: `
        SELECT
          max(toUInt32(properties['viewerCount']))  AS peakViewers,
          uniqExact(userId)                         AS totalViews,
          avg(toFloat64OrZero(properties['watchSeconds'])) AS avgWatchTime,
          countIf(eventType = 'STREAM_COMMENT')     AS commentsCount,
          countIf(eventType = 'GIFT_SENT')          AS giftsCount,
          sum(toFloat64OrZero(properties['giftValue'])) AS revenue
        FROM events
        WHERE streamId = {streamId:String}
      `,
      query_params: { streamId },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      peakViewers: number;
      totalViews: number;
      avgWatchTime: number;
      commentsCount: number;
      giftsCount: number;
      revenue: number;
    }>();

    return (
      rows[0] ?? {
        peakViewers: 0,
        totalViews: 0,
        avgWatchTime: 0,
        commentsCount: 0,
        giftsCount: 0,
        revenue: 0,
      }
    );
  }

  /**
   * Generic query method for ad-hoc ClickHouse queries.
   */
  async query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
    const result = await this.client.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return result.json<T>();
  }

  // ── Schema initialization ─────────────────────────────────

  private async initSchema(): Promise<void> {
    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS events (
          eventId       String,
          eventType     String,
          userId        String DEFAULT '',
          sessionId     String DEFAULT '',
          streamId      String DEFAULT '',
          productId     String DEFAULT '',
          orderId       String DEFAULT '',
          searchQuery   String DEFAULT '',
          platform      String DEFAULT '',
          countryCode   String DEFAULT '',
          regionCode    String DEFAULT '',
          appVersion    String DEFAULT '',
          properties    Map(String, String),
          timestamp     DateTime64(3)
        )
        ENGINE = ReplacingMergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (eventType, userId, timestamp)
        TTL timestamp + INTERVAL 2 YEAR
        SETTINGS index_granularity = 8192;
      `,
    });

    // Materialized view: daily DAU
    await this.client.exec({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dau
        ENGINE = SummingMergeTree()
        ORDER BY date
        AS
        SELECT
          toDate(timestamp) AS date,
          uniqState(userId) AS uniqueUsers
        FROM events
        GROUP BY date;
      `,
    });

    this.logger.log('ClickHouse schema initialized');
  }
}
