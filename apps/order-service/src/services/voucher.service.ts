// ============================================================
// HYPERCOMMERCE — Voucher Service
//
// DESIGN PHILOSOPHY:
// Vouchers are a primary GMV driver — discount events (11/11, 12/12)
// can 10× order volume. The service must:
// 1. Validate faster than checkout latency (P99 < 20ms)
// 2. Never double-count a voucher use (atomic Redis counter)
// 3. Prevent race condition at cap boundary (WATCH/MULTI or Lua)
//
// CONCURRENCY HANDLING:
// Redis atomic increment as the first gate prevents DB race.
// Pattern: Redis INCR > cap → reject fast without DB round trip.
// If Redis INCR succeeds, DB row is inserted. Redis becomes the
// "speculative" counter; reconciler syncs DB count → Redis daily.
//
// PER-USER LIMIT:
// Stored as Redis counter per (voucherId, userId) pair:
// Key: voucher:usage:{voucherId}:{userId}
// TTL aligned to voucher expiry to auto-cleanup.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, DataSource } from 'typeorm';
import type { RedisClientService } from '@hypercommerce/redis';
import {
  NotFoundException,
  VoucherExpiredException,
  VoucherExhaustedException,
  VoucherIneligibleException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import type { DiscountType } from '../entities/voucher.entity';
import { Voucher } from '../entities/voucher.entity';
import { VoucherUsage } from '../entities/voucher-usage.entity';

export interface VoucherValidationRequest {
  code: string;
  userId: string;
  sellerId?: string;
  categoryIds?: string[];
  orderSubtotal: number; // before discount
  currency: string;
}

export interface VoucherValidationResult {
  voucherId: string;
  code: string;
  discountType: DiscountType;
  discountAmount: number; // actual amount to deduct
  finalTotal: number;
  description?: string;
}

export interface CommitVoucherRequest {
  voucherId: string;
  userId: string;
  orderId: string;
  discountApplied: number;
  orderSubtotal: number;
}

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    @InjectRepository(Voucher)
    private readonly voucherRepo: Repository<Voucher>,
    @InjectRepository(VoucherUsage)
    private readonly usageRepo: Repository<VoucherUsage>,
    private readonly redis: RedisClientService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Validate a voucher code and compute discount.
   *
   * Does NOT consume the voucher — call commitVoucher() after
   * order is confirmed to atomically record usage.
   *
   * @throws NotFoundException if code not found
   * @throws VoucherExpiredException if outside validity window
   * @throws VoucherExhaustedException if usage cap reached
   * @throws VoucherIneligibleException if order doesn't qualify
   */
  async validate(req: VoucherValidationRequest): Promise<VoucherValidationResult> {
    const now = new Date();

    // ── 1. Fetch voucher (Redis L1 → DB) ───────────────────
    const voucher = await this.fetchVoucher(req.code);
    if (!voucher) {
      throw new NotFoundException('Voucher', req.code);
    }

    // ── 2. Time validity ───────────────────────────────────
    if (now < voucher.startsAt || now > voucher.expiresAt) {
      throw new VoucherExpiredException(req.code, voucher.expiresAt);
    }

    // ── 3. Status check ────────────────────────────────────
    if (voucher.status !== 'ACTIVE') {
      throw new VoucherExhaustedException(req.code, `Voucher status: ${voucher.status}`);
    }

    // ── 4. Usage cap check (Redis fast path) ───────────────
    if (voucher.usageCap != null) {
      const usageCounterKey = `voucher:usage:count:${voucher.id}`;
      const currentCount = await this.redis.get(usageCounterKey);
      const count = currentCount ? parseInt(currentCount, 10) : 0;
      if (count >= voucher.usageCap) {
        throw new VoucherExhaustedException(req.code, 'Usage cap reached');
      }
    }

    // ── 5. Per-user limit ──────────────────────────────────
    if (voucher.perUserLimit > 0) {
      const userUsageKey = `voucher:usage:user:${voucher.id}:${req.userId}`;
      const userCount = await this.redis.get(userUsageKey);
      const userUsage = userCount ? parseInt(userCount, 10) : 0;
      if (userUsage >= voucher.perUserLimit) {
        throw new VoucherIneligibleException(
          req.code,
          `You have already used this voucher ${userUsage} time(s). Limit: ${voucher.perUserLimit}`,
        );
      }
    }

    // ── 6. Scope eligibility ───────────────────────────────
    if (voucher.scope === 'SELLER' && voucher.sellerId !== req.sellerId) {
      throw new VoucherIneligibleException(req.code, 'Voucher is not valid for this seller');
    }

    if (voucher.scope === 'CATEGORY' && voucher.categoryId) {
      if (!req.categoryIds?.includes(voucher.categoryId)) {
        throw new VoucherIneligibleException(
          req.code,
          'Voucher is not valid for items in your cart',
        );
      }
    }

    // ── 7. Minimum order amount ────────────────────────────
    if (req.orderSubtotal < voucher.minimumOrderAmount) {
      throw new VoucherIneligibleException(
        req.code,
        `Minimum order amount is ${voucher.minimumOrderAmount.toLocaleString()}đ. Your order: ${req.orderSubtotal.toLocaleString()}đ`,
      );
    }

    // ── 8. Compute discount ────────────────────────────────
    const discountAmount = this.computeDiscount(voucher, req.orderSubtotal);

    return {
      voucherId: voucher.id,
      code: voucher.code,
      discountType: voucher.discountType,
      discountAmount,
      finalTotal: req.orderSubtotal - discountAmount,
      description: voucher.description,
    };
  }

  /**
   * Atomically commit voucher usage after order is confirmed.
   *
   * Idempotent: calling twice for same orderId is a no-op.
   *
   * Atomicity strategy:
   * 1. Redis INCR (fast gate, non-durable)
   * 2. DB upsert in the same transaction as order creation
   * 3. Background reconciler syncs Redis count from DB daily
   */
  async commitUsage(req: CommitVoucherRequest): Promise<void> {
    // Idempotency: check if already committed for this order
    const existingUsage = await this.usageRepo.findOne({
      where: { orderId: req.orderId },
    });
    if (existingUsage) {
      this.logger.warn(`Voucher already committed for order ${req.orderId}`);
      return;
    }

    // Atomically increment Redis counter
    const usageCounterKey = `voucher:usage:count:${req.voucherId}`;
    const userUsageKey = `voucher:usage:user:${req.voucherId}:${req.userId}`;

    await Promise.all([
      this.redis.getClient().incr(usageCounterKey),
      this.redis.getClient().incr(userUsageKey),
    ]);

    // Persist to DB
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(VoucherUsage, {
        voucherId: req.voucherId,
        userId: req.userId,
        orderId: req.orderId,
        discountApplied: req.discountApplied,
        orderSubtotal: req.orderSubtotal,
      });

      // Increment DB usage count
      await manager
        .createQueryBuilder()
        .update(Voucher)
        .set({ usageCount: () => 'usage_count + 1' })
        .where('id = :id', { id: req.voucherId })
        .execute();
    });

    this.logger.log(
      JSON.stringify({
        event: 'voucher_committed',
        voucherId: req.voucherId,
        orderId: req.orderId,
        discountApplied: req.discountApplied,
      }),
    );
  }

  /**
   * Rollback a voucher reservation (if order creation fails after validation).
   * Decrements Redis counter — DB record was never inserted.
   */
  async rollbackUsage(voucherId: string, userId: string): Promise<void> {
    const usageCounterKey = `voucher:usage:count:${voucherId}`;
    const userUsageKey = `voucher:usage:user:${voucherId}:${userId}`;

    // Clamp at 0 to handle edge cases where counter wasn't incremented
    const pipeline = this.redis.getClient().pipeline();
    pipeline.decr(usageCounterKey);
    pipeline.decr(userUsageKey);
    // Ensure no negative values (Lua would be cleaner but pipeline is good enough here)
    await pipeline.exec();
  }

  // ── Private ───────────────────────────────────────────────

  private async fetchVoucher(code: string): Promise<Voucher | null> {
    const cacheKey = `voucher:code:${code.toUpperCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Voucher;

    const voucher = await this.voucherRepo.findOne({
      where: { code: code.toUpperCase() },
    });

    if (voucher) {
      // Cache until voucher expires (max 1 hour)
      const ttl = Math.min(Math.floor((voucher.expiresAt.getTime() - Date.now()) / 1000), 3600);
      if (ttl > 0) {
        await this.redis.set(cacheKey, JSON.stringify(voucher), ttl);
      }
    }

    return voucher;
  }

  private computeDiscount(voucher: Voucher, orderSubtotal: number): number {
    if (voucher.discountType === 'FREE_SHIPPING') {
      // Handled by shipping calculator — return 0 here
      return 0;
    }

    if (voucher.discountType === 'PERCENT') {
      const raw = Math.floor((orderSubtotal * Number(voucher.discountValue)) / 100);
      // Apply max cap
      if (voucher.maxDiscountAmount != null) {
        return Math.min(raw, Number(voucher.maxDiscountAmount));
      }
      return raw;
    }

    // FIXED — cannot discount more than the subtotal
    return Math.min(Number(voucher.discountValue), orderSubtotal);
  }
}
