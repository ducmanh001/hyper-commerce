import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PlanTier {
  FREE = 'FREE',
  BASIC = 'BASIC', // ₫299K/month
  PROFESSIONAL = 'PROFESSIONAL', // ₫799K/month
  ENTERPRISE = 'ENTERPRISE', // Custom SLA
}

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: PlanTier, unique: true })
  tier: PlanTier;

  @Column({ length: 100 })
  name: string; // "Gói Cơ Bản", "Gói Chuyên Nghiệp", etc.

  // Monthly price in VND (0 for FREE, -1 for ENTERPRISE custom)
  @Column({ type: 'int', default: 0 })
  monthlyPriceVnd: number;

  // Stripe price ID (for recurring billing)
  @Column({ length: 100, nullable: true })
  stripePriceId: string | null;

  // Max products a seller can list under this plan
  @Column({ type: 'int', default: 50 })
  maxProducts: number;

  // Commission discount percentage points (e.g. 0.5 = -0.5% off standard rate)
  @Column({ type: 'decimal', precision: 4, scale: 2, default: 0 })
  commissionDiscountPct: number;

  // Whether products get "Featured" badge in search results
  @Column({ type: 'boolean', default: false })
  featuredBadge: boolean;

  // Monthly free ad credits in VND
  @Column({ type: 'int', default: 0 })
  adCreditVnd: number;

  // Analytics dashboard access
  @Column({ type: 'boolean', default: false })
  advancedAnalytics: boolean;

  // Priority support SLA in hours
  @Column({ type: 'int', nullable: true })
  supportSlaHours: number | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn() createdAt: Date;
}
