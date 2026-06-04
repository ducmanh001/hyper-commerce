// ============================================================
// HYPERCOMMERCE — Tools: Database Tools
//
// Safe, typed database access for agents.
// Agents should use these tools rather than raw SQL.
// Uses parameterized queries to prevent injection.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseToolsService {
  private readonly logger = new Logger(DatabaseToolsService.name);
  private pool: Pool;

  constructor(private readonly config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.get<string>('DATABASE_URL'),
      max: 5, // small pool — agents are not the primary DB user
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  // ── Fraud Analysis Queries ──────────────────────────────────

  async getUserOrderVelocity(userId: string): Promise<{
    ordersLastHour: number;
    ordersLastDay: number;
    failedPaymentsLastDay: number;
  }> {
    const result = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS orders_last_hour,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')  AS orders_last_day,
         COUNT(*) FILTER (
           WHERE created_at > NOW() - INTERVAL '1 day'
           AND status = 'PAYMENT_FAILED'
         ) AS failed_payments_last_day
       FROM orders
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    const row = result.rows[0];
    return {
      ordersLastHour: parseInt(row.orders_last_hour ?? '0', 10),
      ordersLastDay: parseInt(row.orders_last_day ?? '0', 10),
      failedPaymentsLastDay: parseInt(row.failed_payments_last_day ?? '0', 10),
    };
  }

  // ── Analytics Queries ──────────────────────────────────────

  async getTopProducts(
    limit = 10,
    periodDays = 7,
  ): Promise<Array<{ productId: string; orderCount: number; revenue: number }>> {
    const result = await this.pool.query(
      `SELECT
         oi.product_id AS "productId",
         COUNT(DISTINCT oi.order_id) AS "orderCount",
         SUM(oi.price * oi.quantity) AS "revenue"
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at > NOW() - ($2 || ' days')::INTERVAL
         AND o.status = 'DELIVERED'
         AND o.deleted_at IS NULL
       GROUP BY oi.product_id
       ORDER BY "revenue" DESC
       LIMIT $1`,
      [limit, periodDays],
    );

    return result.rows;
  }

  async getGMVByHour(lookbackHours = 24): Promise<Array<{ hour: string; gmv: number }>> {
    const result = await this.pool.query(
      `SELECT
         DATE_TRUNC('hour', created_at) AS hour,
         SUM(total_amount) AS gmv
       FROM orders
       WHERE created_at > NOW() - ($1 || ' hours')::INTERVAL
         AND status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED')
         AND deleted_at IS NULL
       GROUP BY 1
       ORDER BY 1`,
      [lookbackHours],
    );

    return result.rows.map((r) => ({ hour: r.hour as string, gmv: parseFloat(r.gmv) }));
  }

  // ── Support Queries ────────────────────────────────────────

  async getOrderById(orderId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              json_agg(json_build_object(
                'productId', oi.product_id,
                'quantity', oi.quantity,
                'price', oi.price
              )) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1 AND o.deleted_at IS NULL
       GROUP BY o.id`,
      [orderId],
    );

    return result.rows[0] ?? null;
  }
}
