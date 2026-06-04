import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { SubscriptionPlan, PlanTier } from './entities/subscription-plan.entity';
import { SellerSubscription, SubscriptionStatus } from './entities/seller-subscription.entity';

// WHY Redis for seller tier?
// Commission service, ads service, and order service all need to read a seller's tier
// on every request. DB query for every order placement is too slow.
// Redis key: hc:seller:tier:{sellerId} → { tier, commissionDiscountPct, featuredBadge, adCreditVnd }
// TTL: 24h (refreshed on plan change or daily cron)
const SELLER_TIER_KEY = (sellerId: string) => `hc:seller:tier:${sellerId}`;

export interface SellerTierInfo {
  tier: PlanTier;
  commissionDiscountPct: number;
  featuredBadge: boolean;
  adCreditVnd: number;
  maxProducts: number;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(SubscriptionPlan) private planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(SellerSubscription) private subRepo: Repository<SellerSubscription>,
    @InjectRedis() private redis: Redis,
  ) {}

  async listPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({ where: { isActive: true }, order: { monthlyPriceVnd: 'ASC' } });
  }

  async getSellerSubscription(sellerId: string): Promise<SellerSubscription | null> {
    return this.subRepo.findOne({ where: { sellerId } });
  }

  // Called when Stripe webhook confirms payment (invoice.paid)
  async activateSubscription(
    sellerId: string,
    planId: string,
    stripeData: {
      subscriptionId: string;
      customerId: string;
      periodStart: Date;
      periodEnd: Date;
      amountPaid: number;
    },
  ): Promise<SellerSubscription> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    // Upsert: update existing or create new
    let sub = await this.subRepo.findOne({ where: { sellerId } });
    if (!sub) {
      sub = this.subRepo.create({ sellerId });
    }

    Object.assign(sub, {
      planId: plan.id,
      planTier: plan.tier,
      status: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: stripeData.subscriptionId,
      stripeCustomerId: stripeData.customerId,
      currentPeriodStart: stripeData.periodStart,
      currentPeriodEnd: stripeData.periodEnd,
      nextBillingAt: stripeData.periodEnd,
      lastPaidVnd: stripeData.amountPaid,
    });

    const saved = await this.subRepo.save(sub);

    // Sync tier info to Redis so other services can read it instantly
    await this.syncTierToRedis(sellerId, plan);

    this.logger.log(`Seller ${sellerId} activated plan ${plan.tier}`);
    return saved;
  }

  // Called when seller explicitly cancels
  async cancelSubscription(sellerId: string, reason?: string): Promise<SellerSubscription> {
    const sub = await this.subRepo.findOne({ where: { sellerId } });
    if (!sub) throw new NotFoundException('No active subscription');

    sub.status = SubscriptionStatus.CANCELLED;
    sub.cancelReason = reason ?? null;
    sub.cancelledAt = new Date();
    const saved = await this.subRepo.save(sub);

    // Downgrade to FREE tier in Redis
    const freePlan = await this.planRepo.findOne({ where: { tier: PlanTier.FREE } });
    if (freePlan) await this.syncTierToRedis(sellerId, freePlan);

    return saved;
  }

  // Called when payment fails (invoice.payment_failed webhook)
  async markPastDue(sellerId: string): Promise<void> {
    await this.subRepo.update({ sellerId }, { status: SubscriptionStatus.PAST_DUE });
    this.logger.warn(`Seller ${sellerId} subscription past due — payment failed`);
  }

  // Get tier info with Redis cache (read by commission-service and others)
  async getSellerTier(sellerId: string): Promise<SellerTierInfo> {
    const cached = await this.redis.get(SELLER_TIER_KEY(sellerId));
    if (cached) return JSON.parse(cached) as SellerTierInfo;

    // Cache miss: read from DB
    const sub = await this.subRepo.findOne({
      where: { sellerId, status: SubscriptionStatus.ACTIVE },
    });
    const tier = sub?.planTier ?? PlanTier.FREE;
    const plan = await this.planRepo.findOne({ where: { tier } });

    const info: SellerTierInfo = {
      tier,
      commissionDiscountPct: plan?.commissionDiscountPct ?? 0,
      featuredBadge: plan?.featuredBadge ?? false,
      adCreditVnd: plan?.adCreditVnd ?? 0,
      maxProducts: plan?.maxProducts ?? 50,
    };

    await this.redis.set(SELLER_TIER_KEY(sellerId), JSON.stringify(info), 'EX', 86_400);
    return info;
  }

  private async syncTierToRedis(sellerId: string, plan: SubscriptionPlan): Promise<void> {
    const info: SellerTierInfo = {
      tier: plan.tier,
      commissionDiscountPct: Number(plan.commissionDiscountPct),
      featuredBadge: plan.featuredBadge,
      adCreditVnd: plan.adCreditVnd,
      maxProducts: plan.maxProducts,
    };
    // 25h TTL so nightly jobs can refresh without cache gap
    await this.redis.set(SELLER_TIER_KEY(sellerId), JSON.stringify(info), 'EX', 90_000);
  }
}
