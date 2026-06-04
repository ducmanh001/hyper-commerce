import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

// ====================================================================
// WHY DIRECT SQL INSTEAD OF REPOSITORY PATTERN HERE?
// Admin queries are complex aggregations that span multiple tables and
// materialized views. Using TypeORM QueryBuilder for these adds
// abstraction overhead with zero benefit — the queries are not reused
// and do not need entity mapping. Direct parameterised SQL is clearer,
// easier to read for the next dev, and still fully safe from injection
// (we use $1/$2 params, never string concatenation with user input).
// ====================================================================

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly dataSource: DataSource) {}

  // ------------------------------------------------------------------
  // DASHBOARD SUMMARY
  // Returns all KPIs needed for the home screen in a single DB round-trip
  // using CTEs — avoids N+1 from calling multiple endpoints.
  // ------------------------------------------------------------------

  async getDashboardSummary(date?: string): Promise<Record<string, unknown>> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);

    const [row] = await this.dataSource.query<Array<Record<string, unknown>>>(
      `
      WITH today_orders AS (
        SELECT
          COUNT(*) FILTER (WHERE status != 'CANCELLED')              AS orders_today,
          SUM(total_amount) FILTER (WHERE status != 'CANCELLED')     AS gmv_today,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')               AS cancelled_today,
          COUNT(*) FILTER (WHERE status = 'CONFIRMED')               AS confirmed_today
        FROM orders
        WHERE DATE(created_at) = $1::date
      ),
      payment_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'CAPTURED')                AS payments_captured,
          COUNT(*)                                                    AS payments_total
        FROM payments
        WHERE DATE(created_at) = $1::date
      ),
      dispute_stats AS (
        SELECT COUNT(*) AS open_disputes
        FROM disputes
        WHERE status IN ('AWAITING_SELLER_RESPONSE', 'ESCALATED')
      ),
      new_users AS (
        SELECT COUNT(*) AS new_users_today
        FROM users
        WHERE DATE(created_at) = $1::date
      )
      SELECT
        o.orders_today,
        o.gmv_today,
        o.cancelled_today,
        o.confirmed_today,
        CASE WHEN p.payments_total > 0
             THEN ROUND(p.payments_captured::numeric / p.payments_total * 100, 2)
             ELSE 0
        END AS payment_success_rate_pct,
        d.open_disputes,
        u.new_users_today
      FROM today_orders o, payment_stats p, dispute_stats d, new_users u
      `,
      [targetDate],
    );

    return { date: targetDate, ...row };
  }

  // ------------------------------------------------------------------
  // GMV
  // Reads from materialized view — fast, no heavy aggregation on main table.
  // pg_cron refreshes mv_platform_daily_gmv every 5 minutes.
  // ------------------------------------------------------------------

  async getGmv(
    period: 'daily' | 'weekly' | 'monthly',
    from?: string,
    to?: string,
  ): Promise<unknown[]> {
    // Truncate by period to aggregate the daily materialized view
    const trunc = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
    const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.query(
      `
      SELECT
        DATE_TRUNC($1, gmv_date)     AS period,
        SUM(total_gmv)               AS gmv,
        SUM(total_orders)            AS orders,
        SUM(total_commission)        AS platform_commission,
        ROUND(SUM(total_commission)::numeric / NULLIF(SUM(total_gmv), 0) * 100, 2) AS commission_take_rate_pct
      FROM mv_platform_daily_gmv
      WHERE gmv_date BETWEEN $2::date AND $3::date
      GROUP BY 1
      ORDER BY 1 DESC
      `,
      [trunc, fromDate, toDate],
    );
  }

  async getGmvByCategory(from?: string, to?: string): Promise<unknown[]> {
    const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.query(
      `
      SELECT
        oi.product_category,
        SUM(oi.unit_price * oi.quantity)                         AS gmv,
        COUNT(DISTINCT o.id)                                     AS orders,
        ROUND(AVG(oi.unit_price * oi.quantity)::numeric, 2)     AS avg_basket
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status NOT IN ('CANCELLED')
        AND DATE(o.created_at) BETWEEN $1::date AND $2::date
      GROUP BY 1
      ORDER BY gmv DESC
      `,
      [fromDate, toDate],
    );
  }

  // ------------------------------------------------------------------
  // ORDER FUNNEL
  // Conversion rates at each step — helps identify drop-off points.
  // e.g., high stock_reserved→cancelled ratio = inventory problem
  //       high payment_failed ratio = payment processor issue
  // ------------------------------------------------------------------

  async getOrderFunnel(from?: string, to?: string): Promise<unknown> {
    const fromDate = from ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    const [row] = await this.dataSource.query<Array<Record<string, unknown>>>(
      `
      SELECT
        COUNT(*)                                              AS total_created,
        COUNT(*) FILTER (WHERE status != 'PENDING')          AS stock_reserved,
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'COMPLETED', 'SHIPPED', 'DELIVERED')) AS payment_captured,
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'COMPLETED')) AS confirmed,
        COUNT(*) FILTER (WHERE status = 'DELIVERED')         AS delivered,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')         AS cancelled
      FROM orders
      WHERE DATE(created_at) BETWEEN $1::date AND $2::date
      `,
      [fromDate, toDate],
    );

    const total = Number(row['total_created']) || 1;
    return {
      range: { from: fromDate, to: toDate },
      funnel: {
        created: { count: row['total_created'], rate: 1 },
        stock_reserved: {
          count: row['stock_reserved'],
          rate: Number(row['stock_reserved']) / total,
        },
        payment_captured: {
          count: row['payment_captured'],
          rate: Number(row['payment_captured']) / total,
        },
        confirmed: { count: row['confirmed'], rate: Number(row['confirmed']) / total },
        delivered: { count: row['delivered'], rate: Number(row['delivered']) / total },
        cancelled: { count: row['cancelled'], rate: Number(row['cancelled']) / total },
      },
    };
  }

  async getHourlyThroughput(): Promise<unknown[]> {
    // mv_hourly_order_throughput is refreshed every minute by pg_cron
    return this.dataSource.query(
      `
      SELECT hour_bucket, orders_created, orders_confirmed, orders_cancelled
      FROM mv_hourly_order_throughput
      WHERE hour_bucket >= NOW() - INTERVAL '48 hours'
      ORDER BY hour_bucket DESC
      `,
    );
  }

  // ------------------------------------------------------------------
  // SELLERS
  // ------------------------------------------------------------------

  async getSellerLeaderboard(limit = 20, from?: string, to?: string): Promise<unknown[]> {
    const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);
    // Cap limit to prevent abuse — admin UX doesn't need >100 rows
    const safeLimit = Math.min(Math.max(1, limit), 100);

    return this.dataSource.query(
      `
      SELECT
        seller_id,
        SUM(total_gmv)      AS gmv,
        SUM(total_orders)   AS orders,
        SUM(total_commission) AS commission_paid
      FROM mv_seller_daily_gmv
      WHERE gmv_date BETWEEN $1::date AND $2::date
      GROUP BY seller_id
      ORDER BY gmv DESC
      LIMIT $3
      `,
      [fromDate, toDate, safeLimit],
    );
  }

  async getSellerCommissionSummary(
    sellerId: string,
    from?: string,
    to?: string,
  ): Promise<unknown[]> {
    const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.query(
      `
      SELECT
        settlement_period,
        COUNT(*)                            AS order_count,
        SUM(order_gmv)                      AS gmv,
        SUM(platform_commission)            AS platform_commission,
        SUM(seller_net_amount)              AS net_payout,
        MIN(status)                         AS settlement_status
      FROM commissions
      WHERE seller_id = $1
        AND created_at BETWEEN $2::date AND $3::date + INTERVAL '1 day'
      GROUP BY settlement_period
      ORDER BY settlement_period DESC
      `,
      [sellerId, fromDate, toDate],
    );
  }

  // ------------------------------------------------------------------
  // DISPUTES
  // ------------------------------------------------------------------

  async getDisputeQueue(page: number, limit: number): Promise<unknown> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const offset = (Math.max(1, page) - 1) * safeLimit;

    const [rows, [{ count }]] = await Promise.all([
      this.dataSource.query(
        `
        SELECT
          d.id,
          d.order_id,
          d.buyer_id,
          d.seller_id,
          d.reason,
          d.status,
          d.description,
          d.requested_refund_amount,
          d.created_at,
          d.respond_by_deadline,
          -- Urgency score: escalated = highest, overdue = next, then by age
          CASE d.status
            WHEN 'ESCALATED' THEN 1
            WHEN 'AWAITING_SELLER_RESPONSE' THEN
              CASE WHEN d.respond_by_deadline < NOW() THEN 2 ELSE 3 END
            ELSE 4
          END AS urgency_rank
        FROM disputes d
        WHERE d.status IN ('AWAITING_SELLER_RESPONSE', 'AWAITING_BUYER_EVIDENCE', 'ESCALATED')
        ORDER BY urgency_rank ASC, d.respond_by_deadline ASC NULLS LAST
        LIMIT $1 OFFSET $2
        `,
        [safeLimit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM disputes WHERE status IN ('AWAITING_SELLER_RESPONSE', 'AWAITING_BUYER_EVIDENCE', 'ESCALATED')`,
      ),
    ]);

    return {
      data: rows,
      meta: { page, limit: safeLimit, total: count, pages: Math.ceil(count / safeLimit) },
    };
  }

  async getDisputeStats(from?: string, to?: string): Promise<unknown> {
    const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    const [stats] = await this.dataSource.query<Array<Record<string, unknown>>>(
      `
      SELECT
        COUNT(*)                                                   AS total,
        COUNT(*) FILTER (WHERE status = 'RESOLVED_BUYER_FAVOR')   AS buyer_won,
        COUNT(*) FILTER (WHERE status = 'RESOLVED_SELLER_FAVOR')  AS seller_won,
        COUNT(*) FILTER (WHERE status = 'RESOLVED_PARTIAL_REFUND') AS partial,
        COUNT(*) FILTER (WHERE status = 'ESCALATED')              AS escalated,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600
        )::numeric, 2)                                            AS avg_resolution_hrs,
        SUM(resolved_refund_amount)                               AS total_refunded
      FROM disputes
      WHERE DATE(created_at) BETWEEN $1::date AND $2::date
      `,
      [fromDate, toDate],
    );

    return { range: { from: fromDate, to: toDate }, ...stats };
  }

  // ------------------------------------------------------------------
  // USER MANAGEMENT
  // ------------------------------------------------------------------

  async listUsers(opts: {
    q?: string;
    role?: string;
    status?: string;
    page: number;
    limit: number;
  }) {
    const offset = (opts.page - 1) * opts.limit;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let pi = 1;

    if (opts.q) {
      conditions.push(`(u.email ILIKE $${pi} OR u.full_name ILIKE $${pi})`);
      params.push(`%${opts.q}%`);
      pi++;
    }
    if (opts.role) {
      conditions.push(`u.role = $${pi++}`);
      params.push(opts.role);
    }
    if (opts.status) {
      conditions.push(`u.status = $${pi++}`);
      params.push(opts.status);
    }

    const where = conditions.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT u.id, u.email, u.full_name, u.role, u.status, u.created_at,
                COUNT(o.id) AS order_count
         FROM users u
         LEFT JOIN orders o ON o.user_id = u.id
         WHERE ${where}
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, opts.limit, offset],
      ),
      this.dataSource.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params),
    ]);

    return { items: rows, total: Number(total), page: opts.page, limit: opts.limit };
  }

  async getUserDetail(id: string) {
    const [user] = await this.dataSource.query(
      `SELECT u.*,
              COUNT(DISTINCT o.id)  AS total_orders,
              SUM(o.total_amount)   AS lifetime_value,
              MAX(o.created_at)     AS last_order_at
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id AND o.status != 'CANCELLED'
       WHERE u.id = $1
       GROUP BY u.id`,
      [id],
    );
    return user ?? null;
  }

  async banUser(userId: string, reason: string, durationDays: number | undefined, actorId: string) {
    const bannedUntil = durationDays
      ? new Date(Date.now() + durationDays * 86400000).toISOString()
      : null;

    await this.dataSource.query(
      `UPDATE users SET status = 'BANNED', ban_reason = $2, banned_until = $3, banned_by = $4 WHERE id = $1`,
      [userId, reason, bannedUntil, actorId],
    );
    this.logger.log(`User ${userId} banned by ${actorId}: ${reason}`);
    return { userId, status: 'BANNED', bannedUntil, reason };
  }

  async unbanUser(userId: string, actorId: string) {
    await this.dataSource.query(
      `UPDATE users SET status = 'ACTIVE', ban_reason = NULL, banned_until = NULL, banned_by = NULL WHERE id = $1`,
      [userId],
    );
    this.logger.log(`User ${userId} unbanned by ${actorId}`);
    return { userId, status: 'ACTIVE' };
  }

  async changeUserRole(userId: string, role: string, actorId: string) {
    await this.dataSource.query(`UPDATE users SET role = $2 WHERE id = $1`, [userId, role]);
    this.logger.log(`User ${userId} role changed to ${role} by ${actorId}`);
    return { userId, role };
  }

  async impersonateUser(userId: string, actor: { sub: string; role: string }) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new Error('Only SUPER_ADMIN may impersonate users');
    }
    // In production: issue a short-lived JWT (15 min) with impersonated user's claims
    // + impersonatedBy field for audit trail
    const token = `impersonation-token-for-${userId}-by-${actor.sub}-expires-${Date.now() + 900_000}`;
    this.logger.warn(`Impersonation: ${actor.sub} impersonating ${userId}`);
    return { token, expiresIn: 900 };
  }

  // ------------------------------------------------------------------
  // ORDER MANAGEMENT
  // ------------------------------------------------------------------

  async listOrders(opts: {
    status?: string;
    sellerId?: string;
    userId?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const offset = (opts.page - 1) * opts.limit;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let pi = 1;

    if (opts.status) {
      conditions.push(`o.status = $${pi++}`);
      params.push(opts.status);
    }
    if (opts.sellerId) {
      conditions.push(`o.seller_id = $${pi++}`);
      params.push(opts.sellerId);
    }
    if (opts.userId) {
      conditions.push(`o.user_id = $${pi++}`);
      params.push(opts.userId);
    }
    if (opts.from) {
      conditions.push(`o.created_at >= $${pi++}`);
      params.push(opts.from);
    }
    if (opts.to) {
      conditions.push(`o.created_at <= $${pi++}`);
      params.push(opts.to);
    }

    const where = conditions.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT o.id, o.user_id, o.seller_id, o.status, o.total_amount, o.created_at
         FROM orders o WHERE ${where}
         ORDER BY o.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, opts.limit, offset],
      ),
      this.dataSource.query(`SELECT COUNT(*) AS total FROM orders o WHERE ${where}`, params),
    ]);

    return { items: rows, total: Number(total), page: opts.page, limit: opts.limit };
  }

  async getOrderDetail(id: string) {
    const [order] = await this.dataSource.query(
      `SELECT o.*,
              json_agg(oi.*) AS items,
              json_agg(p.*)  AS payments
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [id],
    );
    return order ?? null;
  }

  async forceOrderStatus(id: string, status: string, reason: string, actorId: string) {
    await this.dataSource.query(
      `UPDATE orders SET status = $2, metadata = metadata || $3::jsonb WHERE id = $1`,
      [
        id,
        status,
        JSON.stringify({
          adminOverride: { status, reason, actorId, at: new Date().toISOString() },
        }),
      ],
    );
    return { id, status };
  }

  // ------------------------------------------------------------------
  // SELLER MANAGEMENT
  // ------------------------------------------------------------------

  async listSellers(opts: {
    q?: string;
    status?: string;
    tier?: string;
    page: number;
    limit: number;
  }) {
    const offset = (opts.page - 1) * opts.limit;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let pi = 1;

    if (opts.q) {
      conditions.push(`(s.business_name ILIKE $${pi} OR u.email ILIKE $${pi})`);
      params.push(`%${opts.q}%`);
      pi++;
    }
    if (opts.status) {
      conditions.push(`s.status = $${pi++}`);
      params.push(opts.status);
    }
    if (opts.tier) {
      conditions.push(`s.tier = $${pi++}`);
      params.push(opts.tier);
    }

    const where = conditions.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT s.*, u.email
         FROM sellers s
         JOIN users u ON u.id = s.user_id
         WHERE ${where}
         ORDER BY s.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, opts.limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM sellers s JOIN users u ON u.id = s.user_id WHERE ${where}`,
        params,
      ),
    ]);

    return { items: rows, total: Number(total), page: opts.page, limit: opts.limit };
  }

  async verifySeller(id: string, actorId: string) {
    await this.dataSource.query(
      `UPDATE sellers SET status = 'ACTIVE', verified_at = NOW(), verified_by = $2 WHERE id = $1`,
      [id, actorId],
    );
    return { id, status: 'ACTIVE' };
  }

  async suspendSeller(id: string, reason: string, actorId: string) {
    await this.dataSource.query(
      `UPDATE sellers SET status = 'SUSPENDED', suspend_reason = $2, suspended_by = $3 WHERE id = $1`,
      [id, reason, actorId],
    );
    return { id, status: 'SUSPENDED', reason };
  }

  // ------------------------------------------------------------------
  // DISPUTE RESOLUTION
  // ------------------------------------------------------------------

  async resolveDispute(
    id: string,
    body: { outcome: string; refundAmount?: number; resolution: string },
    actorId: string,
  ) {
    await this.dataSource.query(
      `UPDATE disputes SET status = 'RESOLVED', outcome = $2, resolved_refund_amount = $3, resolution_notes = $4, resolved_by = $5, resolved_at = NOW() WHERE id = $1`,
      [id, body.outcome, body.refundAmount ?? 0, body.resolution, actorId],
    );
    return { id, outcome: body.outcome };
  }

  // ------------------------------------------------------------------
  // FEATURE FLAGS
  // ------------------------------------------------------------------

  async listFeatureFlags() {
    return this.dataSource.query(`SELECT * FROM feature_flags ORDER BY key ASC`);
  }

  async upsertFeatureFlag(key: string, dto: Record<string, unknown>, actorId: string) {
    await this.dataSource.query(
      `INSERT INTO feature_flags (key, description, enabled, rollout_percent, environments, owner, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET
         description    = EXCLUDED.description,
         enabled        = EXCLUDED.enabled,
         rollout_percent = EXCLUDED.rollout_percent,
         environments   = EXCLUDED.environments,
         owner          = EXCLUDED.owner,
         expires_at     = EXCLUDED.expires_at,
         updated_at     = NOW()`,
      [
        key,
        dto['description'],
        dto['enabled'] ?? false,
        dto['rolloutPercent'] ?? 100,
        dto['environments'] ?? [],
        dto['owner'],
        dto['expiresAt'],
      ],
    );
    this.logger.log(`Feature flag '${key}' upserted by ${actorId}`);
    return this.dataSource
      .query(`SELECT * FROM feature_flags WHERE key = $1`, [key])
      .then(([r]) => r);
  }

  async deleteFeatureFlag(key: string, actorId: string) {
    await this.dataSource.query(`DELETE FROM feature_flags WHERE key = $1`, [key]);
    this.logger.log(`Feature flag '${key}' deleted by ${actorId}`);
  }

  // ------------------------------------------------------------------
  // AUDIT LOGS
  // ------------------------------------------------------------------

  async getAuditLogs(opts: {
    actorId?: string;
    resource?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const offset = (opts.page - 1) * opts.limit;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let pi = 1;

    if (opts.actorId) {
      conditions.push(`actor_id = $${pi++}`);
      params.push(opts.actorId);
    }
    if (opts.resource) {
      conditions.push(`resource = $${pi++}`);
      params.push(opts.resource);
    }
    if (opts.action) {
      conditions.push(`action = $${pi++}`);
      params.push(opts.action);
    }
    if (opts.from) {
      conditions.push(`created_at >= $${pi++}`);
      params.push(opts.from);
    }
    if (opts.to) {
      conditions.push(`created_at <= $${pi++}`);
      params.push(opts.to);
    }

    const where = conditions.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, opts.limit, offset],
      ),
      this.dataSource.query(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`, params),
    ]);

    return { items: rows, total: Number(total), page: opts.page, limit: opts.limit };
  }

  // ------------------------------------------------------------------
  // ROLES
  // ------------------------------------------------------------------

  async listRoles() {
    return [
      {
        role: 'SUPER_ADMIN',
        description: 'Full platform access including system config',
        permissions: ['manage:all'],
      },
      {
        role: 'ADMIN',
        description: 'Full user/order/seller management',
        permissions: [
          'manage:User',
          'manage:Order',
          'manage:Seller',
          'manage:Dispute',
          'manage:Product',
          'manage:Campaign',
          'manage:Subscription',
          'manage:AuditLog',
          'manage:FeatureFlag',
        ],
      },
      {
        role: 'OPS',
        description: 'Customer service operations',
        permissions: [
          'read:User',
          'update:User',
          'read:Order',
          'update:Order',
          'read:Dispute',
          'update:Dispute',
          'approve:Dispute',
          'reject:Dispute',
          'read:Payment',
          'refund:Payment',
        ],
      },
      {
        role: 'FINANCE',
        description: 'Financial reporting and payout management',
        permissions: [
          'read:Report',
          'export:Report',
          'read:Payout',
          'payout:Payout',
          'read:Commission',
          'read:Payment',
          'read:Subscription',
        ],
      },
      {
        role: 'TRUST_SAFETY',
        description: 'Content moderation and fraud investigation',
        permissions: [
          'read:Product',
          'update:Product',
          'approve:Product',
          'reject:Product',
          'read:User',
          'ban:User',
          'unban:User',
          'read:Seller',
          'ban:Seller',
          'unban:Seller',
          'read:Dispute',
          'update:Dispute',
        ],
      },
      {
        role: 'SELLER',
        description: 'Seller portal — own resources only',
        permissions: [
          'create:Product',
          'read:Product',
          'update:Product',
          'delete:Product',
          'create:Campaign',
          'read:Campaign',
          'update:Campaign',
          'read:Order',
          'read:Commission',
          'read:Payout',
        ],
      },
      {
        role: 'BUYER',
        description: 'Standard authenticated customer',
        permissions: [
          'create:Order',
          'read:Order',
          'create:Dispute',
          'read:Dispute',
          'read:Product',
        ],
      },
    ];
  }

  async assignRole(userId: string, role: string, permissions: string[], actorId: string) {
    await this.dataSource.query(`UPDATE users SET role = $2, permissions = $3 WHERE id = $1`, [
      userId,
      role,
      JSON.stringify(permissions),
    ]);
    this.logger.log(`Role ${role} assigned to user ${userId} by ${actorId}`);
    return { userId, role, permissions };
  }

  // ------------------------------------------------------------------
  // FRAUD SIGNALS
  // ------------------------------------------------------------------

  async getFraudSignals(riskLevel: string | undefined, page: number) {
    const limit = 50;
    const offset = (page - 1) * limit;
    const conditions = riskLevel ? [`risk_level = $1`] : ["risk_level IN ('HIGH','MEDIUM')"];
    const params = riskLevel ? [riskLevel, limit, offset] : [limit, offset];
    const pi = riskLevel ? 2 : 1;

    const rows = await this.dataSource.query(
      `SELECT fs.*, u.email FROM fraud_signals fs JOIN users u ON u.id = fs.user_id WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      params,
    );
    return { items: rows, page, limit };
  }

  async getChargebackRate(from?: string, to?: string) {
    const fromDate = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    const [row] = await this.dataSource.query(
      `SELECT
         DATE_TRUNC('week', created_at) AS week,
         COUNT(*) FILTER (WHERE chargeback = true) AS chargebacks,
         COUNT(*) AS total_payments,
         ROUND(COUNT(*) FILTER (WHERE chargeback = true)::numeric / NULLIF(COUNT(*),0) * 100, 2) AS chargeback_rate
       FROM payments
       WHERE DATE(created_at) BETWEEN $1::date AND $2::date
       GROUP BY 1 ORDER BY 1`,
      [fromDate, toDate],
    );
    return row;
  }

  // ------------------------------------------------------------------
  // CONTENT MODERATION
  // ------------------------------------------------------------------

  async getModerationQueue(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT p.*, s.business_name AS seller_name FROM products p JOIN sellers s ON s.id = p.seller_id WHERE p.moderation_status = 'PENDING' ORDER BY p.created_at ASC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM products WHERE moderation_status = 'PENDING'`,
      ),
    ]);
    return { items: rows, total: Number(total), page, limit };
  }

  async moderateProduct(
    productId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    actorId: string,
  ) {
    await this.dataSource.query(
      `UPDATE products SET moderation_status = $2, moderation_reason = $3, moderated_by = $4, moderated_at = NOW() WHERE id = $1`,
      [productId, decision, reason, actorId],
    );
    return { productId, decision };
  }

  // ------------------------------------------------------------------
  // FINANCE / PAYOUTS
  // ------------------------------------------------------------------

  async getRevenueSummary(from?: string, to?: string) {
    const fromDate = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);

    const [commissions, adRevenue, subscriptions] = await Promise.all([
      this.dataSource.query(
        `SELECT SUM(platform_commission) AS total FROM commissions WHERE DATE(created_at) BETWEEN $1::date AND $2::date`,
        [fromDate, toDate],
      ),
      this.dataSource.query(
        `SELECT SUM(fee_vnd) AS total FROM ad_impressions WHERE DATE(created_at) BETWEEN $1::date AND $2::date`,
        [fromDate, toDate],
      ),
      this.dataSource.query(
        `SELECT SUM(last_paid_vnd) AS total FROM seller_subscriptions WHERE DATE(updated_at) BETWEEN $1::date AND $2::date`,
        [fromDate, toDate],
      ),
    ]);

    return {
      range: { from: fromDate, to: toDate },
      commissions: Number(commissions[0]?.total ?? 0),
      adRevenue: Number(adRevenue[0]?.total ?? 0),
      subscriptions: Number(subscriptions[0]?.total ?? 0),
      total:
        Number(commissions[0]?.total ?? 0) +
        Number(adRevenue[0]?.total ?? 0) +
        Number(subscriptions[0]?.total ?? 0),
    };
  }

  async getPayouts(status: string | undefined, page: number) {
    const limit = 50;
    const offset = (page - 1) * limit;
    const where = status ? `WHERE py.status = $1` : `WHERE py.status = 'PENDING'`;
    const params = status ? [status, limit, offset] : [limit, offset];
    const pi = status ? 2 : 1;

    const rows = await this.dataSource.query(
      `SELECT py.*, s.business_name FROM payouts py JOIN sellers s ON s.id = py.seller_id ${where} ORDER BY py.created_at ASC LIMIT $${pi} OFFSET $${pi + 1}`,
      params,
    );
    return { items: rows, page, limit };
  }

  async processPayout(id: string, actorId: string) {
    await this.dataSource.query(
      `UPDATE payouts SET status = 'PROCESSING', processed_by = $2, processed_at = NOW() WHERE id = $1`,
      [id, actorId],
    );
    return { id, status: 'PROCESSING' };
  }

  // ------------------------------------------------------------------
  // SYSTEM METRICS
  // ------------------------------------------------------------------

  async getSystemMetrics() {
    // Real implementation would query pg_stat_activity, Redis INFO, queue depths
    return {
      database: { activeConnections: 0, idleConnections: 0, waitingQueries: 0 },
      redis: { usedMemoryMb: 0, connectedClients: 0, opsPerSec: 0 },
      kafka: { consumerLag: {} },
      uptime: process.uptime(),
      nodeVersion: process.version,
      ts: new Date().toISOString(),
    };
  }

  async getServiceHealthStatus() {
    const services = [
      { name: 'user-service', port: 3001 },
      { name: 'feed-service', port: 3002 },
      { name: 'order-service', port: 3003 },
      { name: 'inventory-service', port: 3004 },
      { name: 'search-service', port: 3005 },
      { name: 'payment-service', port: 3007 },
      { name: 'notification-service', port: 3008 },
      { name: 'analytics-service', port: 3009 },
      { name: 'ai-service', port: 3010 },
      { name: 'ads-service', port: 3012 },
      { name: 'subscription-service', port: 3013 },
    ];

    return services.map((s) => ({
      ...s,
      status: 'unknown', // populated by health-check scraper in production
      latency: null,
    }));
  }
}
