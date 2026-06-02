// ============================================================
// HYPERCOMMERCE — Dispute Entity
//
// Post-purchase trust mechanism: allows buyers to dispute orders
// for non-delivery, wrong item, quality issues, etc.
//
// DISPUTE WINDOW:
// - Standard: 7 days from delivery
// - Electronics: 30 days (warranty protection)
// - Luxury goods: 3 days (fraud prevention)
//
// STATE MACHINE:
// OPEN → AWAITING_SELLER_RESPONSE (seller notified, 3-day deadline)
//      → ESCALATED (seller didn't respond in time → auto-escalate to CS)
//      → RESOLVED_BUYER_FAVOR (refund issued)
//      → RESOLVED_SELLER_FAVOR (no action taken)
//      → CLOSED (withdrawn by buyer or resolved)
// ============================================================

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DisputeReason =
  | 'ITEM_NOT_RECEIVED'
  | 'ITEM_NOT_AS_DESCRIBED'
  | 'DEFECTIVE_ITEM'
  | 'WRONG_ITEM_SENT'
  | 'COUNTERFEIT_ITEM'
  | 'DAMAGED_IN_TRANSIT'
  | 'MISSING_PARTS'
  | 'SELLER_CANCELLED';

export type DisputeStatus =
  | 'OPEN'
  | 'AWAITING_SELLER_RESPONSE'
  | 'AWAITING_BUYER_EVIDENCE'
  | 'ESCALATED'
  | 'RESOLVED_BUYER_FAVOR'
  | 'RESOLVED_SELLER_FAVOR'
  | 'CLOSED';

export type ResolutionType =
  | 'FULL_REFUND'
  | 'PARTIAL_REFUND'
  | 'REPLACEMENT'
  | 'NO_ACTION'
  | 'WITHDRAWAL';

@Entity('disputes')
@Index(['orderId'])
@Index(['buyerId', 'status'])
@Index(['sellerId', 'status'])
@Index(['status', 'respondByDeadline'])  // for escalation scheduler
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  buyerId!: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  sellerId!: string;

  @Column({ type: 'varchar', length: 50 })
  reason!: DisputeReason;

  @Column({ type: 'text' })
  description!: string;

  /** Evidence files (S3 URLs) — photos, screenshots */
  @Column({ type: 'jsonb', default: [] })
  evidenceUrls!: string[];

  @Column({ type: 'varchar', length: 30, default: 'OPEN' })
  status!: DisputeStatus;

  /** Deadline for seller to respond (auto-escalate if missed) */
  @Column({ type: 'timestamp', nullable: true })
  respondByDeadline?: Date;

  /** Refund amount requested by buyer */
  @Column({ type: 'bigint', nullable: true })
  requestedRefundAmount?: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  resolutionType?: ResolutionType;

  @Column({ type: 'bigint', nullable: true })
  resolvedRefundAmount?: number;

  @Column({ type: 'text', nullable: true })
  resolutionNote?: string;

  /** CS agent who handled escalated disputes */
  @Column({ type: 'varchar', length: 36, nullable: true })
  assignedTo?: string;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
