// ============================================================
// HYPERCOMMERCE — Commission Service
//
// Computes and tracks platform commission on every confirmed order.
//
// RATE STRUCTURE (why tiered?):
// Tiered commission incentivizes sellers to grow volume:
// - STANDARD: 5%  (new sellers, low volume)
// - PREMIUM: 3.5% (≥ 100 orders/month or ≥ 50M VND GMV)
// - ENTERPRISE: 2% (negotiated, high-volume brands)
// - FLAGSHIP: 1%  (strategic partners, anchor sellers)
//
// CATEGORY SURCHARGES (per Vietnamese e-commerce practice):
// Some categories have higher operational costs:
// - Electronics: +1% (high return rate, tech support)
// - Luxury goods: +2% (authentication, insurance)
// - Fresh food: -1% (encourage expansion to new verticals)
//
// PAYMENT FEE PASS-THROUGH:
// Stripe: 2.9% + 30¢ USD; VNPay: 1.1%; MoMo: 0.5%
// These are passed through transparently so sellers understand
// their actual take-home.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RedisClientService } from '@hypercommerce/redis';
import { Commission, CommissionStatus, SellerTier } from '../entities/commission.entity';

// ── Rate Tables ───────────────────────────────────────────────

const BASE_RATES: Record<SellerTier, number> = {
  STANDARD: 5.0,
  PREMIUM: 3.5,
  ENTERPRISE: 2.0,
  FLAGSHIP: 1.0,
};

const CATEGORY_SURCHARGES: Record<string, number> = {
  electronics: 1.0,
  luxury: 2.0,
  fresh_food: -1.0,
  automotive: 1.5,
};

const PAYMENT_FEE_RATES: Record<string, number> = {
  CARD: 2.9,    // Stripe %
  WALLET: 0.5,  // MoMo/ZaloPay
  BANK_TRANSFER: 0.0,
  COD: 0.0,
};
const PAYMENT_FIXED_FEE_VND: Record<string, number> = {
  CARD: 7_000,  // ~30¢ USD
  WALLET: 0,
  BANK_TRANSFER: 3_000,
  COD: 0,
};

export interface CreateCommissionInput {
  orderId: string;
  sellerId: string;
  orderGmv: number;
  categoryId?: string;
  paymentMethod: string;
}

export interface CommissionCalculation {
  orderGmv: number;
  commissionRatePercent: number;
  platformCommission: number;
  paymentFee: number;
  sellerNetAmount: number;
  sellerTier: SellerTier;
}

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(
    @InjectRepository(Commission)
    private readonly commissionRepo: Repository<Commission>,
    private readonly redis: RedisClientService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Calculate and persist commission for a confirmed order.
   *
   * Called when order transitions to CONFIRMED status.
   * Idempotent: safe to call multiple times for same orderId.
   */
  async createCommission(input: CreateCommissionInput): Promise<Commission> {
    // Idempotency guard
    const existing = await this.commissionRepo.findOne({
      where: { orderId: input.orderId },
    });
    if (existing) {
      this.logger.log(`Commission already exists for order ${input.orderId}`);
      return existing;
    }

    const sellerTier = await this.getSellerTier(input.sellerId);
    const calc = this.calculate(input.orderGmv, sellerTier, input.categoryId, input.paymentMethod);

    const commission = this.commissionRepo.create({
      orderId: input.orderId,
      sellerId: input.sellerId,
      orderGmv: input.orderGmv,
      sellerNetAmount: calc.sellerNetAmount,
      platformCommission: calc.platformCommission,
      commissionRatePercent: calc.commissionRatePercent,
      sellerTier,
      paymentFee: calc.paymentFee,
      status: 'PENDING',
    });

    const saved = await this.commissionRepo.save(commission);

    this.logger.log(
      JSON.stringify({
        event: 'commission_created',
        orderId: input.orderId,
        sellerId: input.sellerId,
        orderGmv: input.orderGmv,
        platformCommission: calc.platformCommission,
        sellerNet: calc.sellerNetAmount,
        rate: calc.commissionRatePercent,
        tier: sellerTier,
      }),
    );

    return saved;
  }

  /**
   * Mark commission as EARNED when order is delivered.
   * EARNED commissions are eligible for weekly settlement.
   */
  async markEarned(orderId: string): Promise<void> {
    await this.commissionRepo.update(
      { orderId, status: 'PENDING' },
      { status: 'EARNED' as CommissionStatus },
    );
  }

  /**
   * Reverse commission on refund.
   * Idempotent — safe to call multiple times.
   */
  async reverseCommission(orderId: string): Promise<void> {
    const commission = await this.commissionRepo.findOne({ where: { orderId } });
    if (!commission || commission.status === 'REVERSED') return;

    await this.commissionRepo.update(
      { orderId },
      { status: 'REVERSED' as CommissionStatus },
    );

    this.logger.log(
      JSON.stringify({
        event: 'commission_reversed',
        orderId,
        platformCommission: commission.platformCommission,
      }),
    );
  }

  /**
   * Calculate commission breakdown (pure function, no DB).
   * Exposed for order preview / checkout fee summary.
   */
  calculate(
    orderGmv: number,
    sellerTier: SellerTier,
    categoryId?: string,
    paymentMethod = 'CARD',
  ): CommissionCalculation {
    // Base rate by seller tier
    let rate = BASE_RATES[sellerTier];

    // Category surcharge/discount
    if (categoryId && CATEGORY_SURCHARGES[categoryId] != null) {
      rate += CATEGORY_SURCHARGES[categoryId];
    }

    // Clamp: 0.5% min (always take something) to 10% max
    rate = Math.max(0.5, Math.min(rate, 10.0));

    const platformCommission = Math.round((orderGmv * rate) / 100);

    // Payment processing fee
    const paymentFeeRate = PAYMENT_FEE_RATES[paymentMethod] ?? 0;
    const paymentFixedFee = PAYMENT_FIXED_FEE_VND[paymentMethod] ?? 0;
    const paymentFee = Math.round((orderGmv * paymentFeeRate) / 100) + paymentFixedFee;

    const sellerNetAmount = orderGmv - platformCommission - paymentFee;

    return {
      orderGmv,
      commissionRatePercent: rate,
      platformCommission,
      paymentFee,
      sellerNetAmount: Math.max(0, sellerNetAmount),
      sellerTier,
    };
  }

  /**
   * Get seller GMV stats for a period (for commission dashboard).
   */
  async getSellerCommissionSummary(
    sellerId: string,
    from: Date,
    to: Date,
  ): Promise<{
    totalGmv: number;
    totalCommission: number;
    netEarnings: number;
    ordersCount: number;
    avgCommissionRate: number;
  }> {
    const result = await this.commissionRepo
      .createQueryBuilder('c')
      .select('SUM(c.orderGmv)', 'totalGmv')
      .addSelect('SUM(c.platformCommission)', 'totalCommission')
      .addSelect('SUM(c.sellerNetAmount)', 'netEarnings')
      .addSelect('COUNT(*)', 'ordersCount')
      .addSelect('AVG(c.commissionRatePercent)', 'avgCommissionRate')
      .where('c.sellerId = :sellerId', { sellerId })
      .andWhere('c.createdAt BETWEEN :from AND :to', { from, to })
      .andWhere('c.status IN (:...statuses)', { statuses: ['EARNED', 'SETTLED'] })
      .getRawOne<{
        totalGmv: string;
        totalCommission: string;
        netEarnings: string;
        ordersCount: string;
        avgCommissionRate: string;
      }>();

    return {
      totalGmv: parseInt(result?.totalGmv ?? '0', 10),
      totalCommission: parseInt(result?.totalCommission ?? '0', 10),
      netEarnings: parseInt(result?.netEarnings ?? '0', 10),
      ordersCount: parseInt(result?.ordersCount ?? '0', 10),
      avgCommissionRate: parseFloat(result?.avgCommissionRate ?? '0'),
    };
  }

  // ── Private ───────────────────────────────────────────────

  /**
   * Get seller tier from Redis cache (populated by seller-service).
   * Falls back to STANDARD if not found.
   */
  private async getSellerTier(sellerId: string): Promise<SellerTier> {
    const key = `seller:tier:${sellerId}`;
    const cached = await this.redis.get(key);
    if (cached && ['STANDARD', 'PREMIUM', 'ENTERPRISE', 'FLAGSHIP'].includes(cached)) {
      return cached as SellerTier;
    }
    return 'STANDARD';
  }
}
