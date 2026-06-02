// ============================================================
// HYPERCOMMERCE — Voucher Entity
//
// WHY THIS DESIGN:
// Vouchers are a primary conversion driver in Vietnamese e-commerce.
// Design supports:
//   - Percent-off, fixed-amount, free-shipping discounts
//   - Global / seller-specific / category-specific scopes
//   - Per-user usage limits (prevents abuse)
//   - Total usage cap (prevents over-distribution)
//   - Minimum order value threshold
//   - Time-bounded validity
//
// EDGE CASES:
// - Concurrent redemption at cap boundary: handled via
//   atomic Redis counter before DB write
// - Expired but valid in Redis cache: TTL aligned to expiresAt
// - Seller-specific vouchers: buyer can't see them until applied
// ============================================================

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DiscountType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
export type VoucherScope = 'GLOBAL' | 'SELLER' | 'CATEGORY' | 'PRODUCT';
export type VoucherStatus = 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED';

@Entity('vouchers')
@Index(['code'], { unique: true })
@Index(['status', 'startsAt', 'expiresAt'])
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Uppercase, alphanumeric code users type in */
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 20 })
  discountType!: DiscountType;

  /** Percent (0-100) or fixed amount in VND */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  discountValue!: number;

  /** Max discount cap for PERCENT type (prevents huge discounts on expensive items) */
  @Column({ type: 'bigint', nullable: true })
  maxDiscountAmount?: number;

  /** Minimum order total required to apply this voucher */
  @Column({ type: 'bigint', default: 0 })
  minimumOrderAmount!: number;

  /** Scope — who can use it */
  @Column({ type: 'varchar', length: 20, default: 'GLOBAL' })
  scope!: VoucherScope;

  /** Null = global, set = seller-specific voucher */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  sellerId?: string;

  /** Category restriction (null = all categories) */
  @Column({ type: 'varchar', length: 36, nullable: true })
  categoryId?: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: VoucherStatus;

  @Column({ type: 'timestamp' })
  startsAt!: Date;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  /** Total number of times this voucher can be redeemed (null = unlimited) */
  @Column({ type: 'int', nullable: true })
  usageCap?: number;

  /** Current redemption count — incremented atomically */
  @Column({ type: 'int', default: 0 })
  usageCount!: number;

  /** Max times a single user can use this voucher */
  @Column({ type: 'int', default: 1 })
  perUserLimit!: number;

  /** Which user created this voucher (admin or seller) */
  @Column({ type: 'varchar', length: 36 })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
