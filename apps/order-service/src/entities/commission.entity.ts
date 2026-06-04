// ============================================================
// HYPERCOMMERCE — Commission Entity
//
// Platform takes a percentage of every transaction.
// Commission rates vary by seller tier and category.
//
// PAYOUT FLOW:
// 1. Order CONFIRMED → commission record created (status: PENDING)
// 2. Delivery confirmed → commission status → EARNED
// 3. Weekly batch job → EARNED commissions → SETTLED (payout to seller)
// 4. If order REFUNDED → commission REVERSED
//
// WHY NOT CALCULATE AT PAYOUT TIME?
// Rates can change. Locking in rate at transaction time ensures
// sellers know exactly what they'll earn, prevents disputes.
// ============================================================

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type CommissionStatus =
  | 'PENDING' // order confirmed, not yet delivered
  | 'EARNED' // delivery confirmed, awaiting settlement
  | 'SETTLED' // paid out to seller
  | 'REVERSED' // refund occurred
  | 'DISPUTED'; // under review

export type SellerTier = 'STANDARD' | 'PREMIUM' | 'ENTERPRISE' | 'FLAGSHIP';

@Entity('commissions')
@Index(['orderId'], { unique: true })
@Index(['sellerId', 'status'])
@Index(['settlementPeriod', 'status']) // for batch settlement queries
export class Commission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  sellerId!: string;

  /** Gross merchandise value of the order */
  @Column({ type: 'bigint' })
  orderGmv!: number;

  /** Net seller payout (after commission deducted) */
  @Column({ type: 'bigint' })
  sellerNetAmount!: number;

  /** Platform commission amount (VND) */
  @Column({ type: 'bigint' })
  platformCommission!: number;

  /** Commission rate applied (e.g. 5.00 = 5%) */
  @Column({ type: 'numeric', precision: 5, scale: 2 })
  commissionRatePercent!: number;

  /** Seller tier at time of order */
  @Column({ type: 'varchar', length: 20 })
  sellerTier!: SellerTier;

  /** Payment processing fee (passed to seller for transparency) */
  @Column({ type: 'bigint', default: 0 })
  paymentFee!: number;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: CommissionStatus;

  /** YYYYWW format for weekly batch settlement (e.g. "202401") */
  @Column({ type: 'varchar', length: 6, nullable: true })
  settlementPeriod?: string;

  @Column({ type: 'timestamp', nullable: true })
  settledAt?: Date;

  /** Reference to the payout batch job */
  @Column({ type: 'varchar', length: 36, nullable: true })
  settlementBatchId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
