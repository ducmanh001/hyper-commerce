import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@hypercommerce/common';
import { Roles } from '@hypercommerce/common';
import type { ClickHouseService } from './clickhouse/clickhouse.service';

@Controller({ path: 'analytics', version: '1' })
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly clickhouse: ClickHouseService) {}

  @Get('top-products')
  @Roles('ADMIN', 'SELLER')
  async topProducts(
    @Query('limit') limit = '20',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.clickhouse.query<{
      product_id: string;
      views: number;
      orders: number;
      revenue: number;
    }>(
      `SELECT product_id,
              countIf(event = 'view') AS views,
              countIf(event = 'order') AS orders,
              sumIf(amount, event = 'order') AS revenue
       FROM events
       WHERE ts BETWEEN {from:DateTime} AND {to:DateTime}
       GROUP BY product_id
       ORDER BY revenue DESC
       LIMIT {limit:UInt32}`,
      {
        from: from ?? new Date(Date.now() - 7 * 86400000).toISOString(),
        to: to ?? new Date().toISOString(),
        limit: parseInt(limit),
      },
    );
  }

  @Get('revenue')
  @Roles('ADMIN')
  async revenue(
    @Query('granularity') granularity: 'day' | 'hour' = 'day',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const truncFn = granularity === 'hour' ? 'toStartOfHour' : 'toStartOfDay';
    return this.clickhouse.query<{ ts: string; revenue: number; orders: number }>(
      `SELECT ${truncFn}(ts) AS ts,
              sum(amount) AS revenue,
              count() AS orders
       FROM events
       WHERE event = 'order'
         AND ts BETWEEN {from:DateTime} AND {to:DateTime}
       GROUP BY ts
       ORDER BY ts ASC`,
      {
        from: from ?? new Date(Date.now() - 30 * 86400000).toISOString(),
        to: to ?? new Date().toISOString(),
      },
    );
  }

  @Get('funnel')
  @Roles('ADMIN', 'SELLER')
  async conversionFunnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.clickhouse.query<{ step: string; users: number }>(
      `SELECT event AS step, uniq(user_id) AS users
       FROM events
       WHERE event IN ('view', 'add_to_cart', 'checkout', 'order')
         AND ts BETWEEN {from:DateTime} AND {to:DateTime}
       GROUP BY event
       ORDER BY users DESC`,
      {
        from: from ?? new Date(Date.now() - 7 * 86400000).toISOString(),
        to: to ?? new Date().toISOString(),
      },
    );
  }
}
