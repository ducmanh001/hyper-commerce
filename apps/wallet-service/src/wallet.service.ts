// ============================================================
// HYPERCOMMERCE — Wallet Service
// Core wallet operations with SELECT FOR UPDATE concurrency control.
// All amounts in VND dong (BIGINT). Never float.
// ============================================================

import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { RedisClientService } from '@hypercommerce/redis';
import type { TransactionType } from './entities/wallet-transaction.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletOutboxEvent } from './entities/wallet-outbox.entity';
import type { TransactionQueryDto } from './dto/wallet.dto';
import { randomUUID } from 'crypto';

/** Loyalty tier cashback rates */
const CASHBACK_RATE: Record<string, number> = {
  BRONZE: 0.01,
  SILVER: 0.015,
  GOLD: 0.02,
  PLATINUM: 0.03,
};

/** Cumulative GMV thresholds (VND) to reach tier */
const TIER_THRESHOLDS = [
  { tier: 'PLATINUM', min: 100_000_000 },
  { tier: 'GOLD', min: 20_000_000 },
  { tier: 'SILVER', min: 5_000_000 },
  { tier: 'BRONZE', min: 0 },
];

/** Gift split: host gets 70%, platform 30% */
const HOST_SHARE = 0.7;
const PLATFORM_UID = 'platform'; // synthetic platform wallet user

/** Wallet topup rate-limit key */
const RL_TOPUP_KEY = (userId: string) => `wallet:rl:topup:${userId}`;
const RL_TOPUP_TTL = 3600; // seconds
const RL_TOPUP_MAX = 5; // max topups per hour

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT balance_after FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return row ? Number(row.balance_after) : 0;
  }

  async listTransactions(userId: string, dto: TransactionQueryDto) {
    const limit = Math.min(dto.limit ?? 20, 100);
    const params: unknown[] = [userId, limit];
    let where = `WHERE user_id = $1`;
    if (dto.type) {
      params.push(dto.type);
      where += ` AND type = $${params.length}`;
    }
    const rows = await this.dataSource.query(
      `SELECT id, user_id AS "userId", type, amount, balance_after AS "balanceAfter",
              ref_id AS "refId", metadata, created_at AS "createdAt"
       FROM wallet_transactions
       ${where}
       ORDER BY created_at DESC
       LIMIT $2`,
      params,
    );
    return rows.map((r: Record<string, unknown>) => ({
      ...r,
      amount: Number(r['amount']),
      balanceAfter: Number(r['balanceAfter']),
    }));
  }

  /** TOPUP — rate-limited via Redis (max 5/hour per user) */
  async topup(userId: string, amount: number, refId?: string): Promise<WalletTransaction> {
    await this.checkTopupRateLimit(userId);
    return this.dataSource.transaction(async (manager) => {
      const tx = await this.credit(manager, userId, amount, 'TOPUP', refId, {});
      await this.enqueueOutbox(manager, tx, 'WALLET_CREDITED');
      return tx;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Internal credit / debit (called by consumers too)
  // ──────────────────────────────────────────────────────────

  /**
   * Credit wallet — safe for concurrent calls.
   * Uses SELECT FOR UPDATE on the latest row to serialise writes.
   */
  async credit(
    manager: EntityManager,
    userId: string,
    amount: number,
    type: TransactionType,
    refId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction> {
    if (amount <= 0) throw new BadRequestException('Credit amount must be positive');

    const balanceBefore = await this.lockedBalance(manager, userId);
    const balanceAfter = balanceBefore + amount;

    const tx = manager.create(WalletTransaction, {
      userId,
      type,
      amount,
      balanceAfter,
      refId,
      metadata,
    });
    return manager.save(WalletTransaction, tx);
  }

  /**
   * Debit wallet — enforces non-negative balance.
   * SELECT FOR UPDATE on latest row prevents concurrent overdraft.
   */
  async debit(
    manager: EntityManager,
    userId: string,
    amount: number,
    type: TransactionType,
    refId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction> {
    if (amount <= 0) throw new BadRequestException('Debit amount must be positive');

    const balanceBefore = await this.lockedBalance(manager, userId);
    if (balanceBefore < amount) {
      throw new BadRequestException(`Insufficient balance: have ${balanceBefore}, need ${amount}`);
    }
    const balanceAfter = balanceBefore - amount;

    const tx = manager.create(WalletTransaction, {
      userId,
      type,
      amount: -amount, // stored as negative for debits
      balanceAfter,
      refId,
      metadata,
    });
    return manager.save(WalletTransaction, tx);
  }

  // ──────────────────────────────────────────────────────────
  // Cashback (called by OrderDeliveredConsumer)
  // ──────────────────────────────────────────────────────────

  async processCashback(userId: string, orderId: string, orderAmount: number): Promise<void> {
    const cumulativeGmv = await this.getCumulativeGmv(userId);
    const tier = this.resolveTier(cumulativeGmv);
    const rate = CASHBACK_RATE[tier];
    const cashback = Math.floor(orderAmount * rate);

    if (cashback <= 0) return;

    try {
      await this.dataSource.transaction(async (manager) => {
        // Increment Redis GMV counter (non-transactional, best-effort)
        await this.incrementGmv(userId, orderAmount);

        const tx = await this.credit(manager, userId, cashback, 'CASHBACK', orderId, {
          orderAmount,
          cashbackRate: rate,
          tier,
        });
        await this.enqueueOutbox(manager, tx, 'WALLET_CASHBACK_CREDITED');
      });
      this.logger.log(`Cashback ${cashback} VND → user ${userId} (tier=${tier})`);
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        this.logger.warn(`Cashback already processed for orderId=${orderId}`);
      } else {
        throw err;
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Gift split (called by GiftReceivedConsumer — ATOMIC)
  // ──────────────────────────────────────────────────────────

  async processGiftSplit(
    hostUserId: string,
    giftEventId: string,
    totalCoinValue: number,
  ): Promise<void> {
    const hostAmount = Math.floor(totalCoinValue * HOST_SHARE);
    const platformAmount = totalCoinValue - hostAmount; // 30%

    try {
      await this.dataSource.transaction(async (manager) => {
        // Both credits MUST happen atomically in the same transaction
        const hostTx = await this.credit(
          manager,
          hostUserId,
          hostAmount,
          'GIFT_RECEIVE',
          giftEventId,
          { splitShare: HOST_SHARE, totalCoinValue },
        );
        await this.credit(manager, PLATFORM_UID, platformAmount, 'GIFT_RECEIVE', giftEventId, {
          splitShare: 1 - HOST_SHARE,
          totalCoinValue,
          isplatform: true,
        });
        await this.enqueueOutbox(manager, hostTx, 'WALLET_GIFT_CREDITED');
      });
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        this.logger.warn(`Gift split already processed for giftEventId=${giftEventId}`);
      } else {
        throw err;
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────

  /**
   * SELECT FOR UPDATE on the latest wallet row for this user.
   * Returns current balance. Serialises concurrent credit/debit operations.
   */
  private async lockedBalance(manager: EntityManager, userId: string): Promise<number> {
    const rows = await manager.query(
      `SELECT id, balance_after
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [userId],
    );
    return rows.length > 0 ? Number(rows[0].balance_after) : 0;
  }

  /** Enqueue event into wallet_outbox_events (same transaction as the wallet row) */
  private async enqueueOutbox(
    manager: EntityManager,
    tx: WalletTransaction,
    eventType: string,
  ): Promise<void> {
    const event = manager.create(WalletOutboxEvent, {
      aggregateType: 'WalletTransaction',
      aggregateId: tx.id,
      topic: 'wallet.events',
      partitionKey: tx.userId,
      payload: {
        eventId: randomUUID(),
        eventType,
        occurredAt: tx.createdAt?.toISOString() ?? new Date().toISOString(),
        traceId: randomUUID(),
        version: 1,
        userId: tx.userId,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        refId: tx.refId,
        metadata: tx.metadata,
      },
    });
    await manager.save(WalletOutboxEvent, event);
  }

  /** Redis rate limiter — max TOPUP_MAX topups per hour per user */
  private async checkTopupRateLimit(userId: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      const key = RL_TOPUP_KEY(userId);
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, RL_TOPUP_TTL);
      if (count > RL_TOPUP_MAX) {
        throw new ConflictException(`Rate limit exceeded: max ${RL_TOPUP_MAX} topups per hour`);
      }
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      // Redis down → allow (fail-open)
      this.logger.warn('Redis rate limiter unavailable, allowing topup');
    }
  }

  /**
   * Get cumulative GMV from Redis (best-effort cache of total order value).
   * Initialised lazily from DB on first call.
   */
  private async getCumulativeGmv(userId: string): Promise<number> {
    try {
      const client = this.redis.getClient();
      const key = `wallet:gmv:${userId}`;
      const cached = await client.get(key);
      if (cached !== null) return Number(cached);

      // Cold start: compute from DB cashback metadata
      const [row] = await this.dataSource.query(
        `SELECT COALESCE(SUM((metadata->>'orderAmount')::bigint), 0) AS gmv
         FROM wallet_transactions
         WHERE user_id = $1 AND type = 'CASHBACK'`,
        [userId],
      );
      const gmv = Number(row?.gmv ?? 0);
      await client.set(key, String(gmv), 'EX', 3600);
      return gmv;
    } catch {
      return 0; // Redis down → default to BRONZE tier
    }
  }

  private async incrementGmv(userId: string, amount: number): Promise<void> {
    try {
      const client = this.redis.getClient();
      const key = `wallet:gmv:${userId}`;
      await client.incrby(key, amount);
    } catch {
      // best-effort
    }
  }

  private resolveTier(cumulativeGmv: number): string {
    for (const { tier, min } of TIER_THRESHOLDS) {
      if (cumulativeGmv >= min) return tier;
    }
    return 'BRONZE';
  }

  private isDuplicateKey(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>)['code'] === '23505'
    );
  }
}
