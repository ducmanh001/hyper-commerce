// ============================================================
// HYPERCOMMERCE — Voucher Usage Entity
// Tracks which user used which voucher on which order.
// Enables per-user limit enforcement and abuse detection.
// ============================================================

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('voucher_usages')
@Index(['voucherId', 'userId'])  // per-user usage count lookup
@Index(['orderId'], { unique: true }) // one voucher per order
export class VoucherUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  voucherId!: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  /** Discount actually applied (may be less than max due to order total cap) */
  @Column({ type: 'bigint' })
  discountApplied!: number;

  /** Order total before discount */
  @Column({ type: 'bigint' })
  orderSubtotal!: number;

  @CreateDateColumn()
  usedAt!: Date;
}
