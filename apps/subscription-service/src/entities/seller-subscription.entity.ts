import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { PlanTier } from './subscription-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  TRIALING = 'TRIALING',
  PAST_DUE = 'PAST_DUE',   // Payment failed, grace period
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

@Entity('seller_subscriptions')
@Index(['sellerId'], { unique: true }) // One active subscription per seller
@Index(['status', 'currentPeriodEnd'])
export class SellerSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sellerId: string;

  @Column({ type: 'uuid' })
  planId: string;

  @Column({ type: 'enum', enum: PlanTier })
  planTier: PlanTier;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  // Stripe subscription ID for webhook reconciliation
  @Column({ length: 100, nullable: true })
  stripeSubscriptionId: string | null;

  // Stripe customer ID
  @Column({ length: 100, nullable: true })
  stripeCustomerId: string | null;

  @Column({ type: 'timestamptz' })
  currentPeriodStart: Date;

  @Column({ type: 'timestamptz' })
  currentPeriodEnd: Date;

  // Next billing date
  @Column({ type: 'timestamptz', nullable: true })
  nextBillingAt: Date | null;

  // Amount paid in VND (may differ from plan price due to discounts)
  @Column({ type: 'int', default: 0 })
  lastPaidVnd: number;

  // Cancellation reason
  @Column({ length: 500, nullable: true })
  cancelReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
