import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * StockReservation — represents a hold on inventory.
 *
 * Lifecycle:
 * PENDING  → CONFIRMED (payment success, stock deducted)
 *          → RELEASED (payment failed / timeout / cancel)
 *          → EXPIRED (TTL exceeded — background job releases)
 *
 * Each OrderItem has one reservation.
 * Reservations expire after 15 minutes (configurable).
 */
@Entity('stock_reservations')
@Index(['orderId'])
@Index(['productId', 'variantId'])
@Index(['expiresAt'], { where: "status = 'PENDING'" })  // Partial index for expiry queries
export class StockReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Column({ type: 'varchar', length: 36 })
  productId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  variantId?: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED';

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  idempotencyKey?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
