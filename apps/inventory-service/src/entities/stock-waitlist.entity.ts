import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from 'typeorm';

export enum WaitlistType {
  BACK_IN_STOCK = 'back_in_stock', // Notify when product is restocked
  PRICE_DROP = 'price_drop', // Notify when price drops below target
  PRE_ORDER = 'pre_order', // Reserve spot for upcoming product
}

export enum WaitlistStatus {
  WAITING = 'waiting',
  NOTIFIED = 'notified', // Notification sent
  CONVERTED = 'converted', // User placed order after notification
  AUTO_ORDERED = 'auto_ordered', // System auto-created order (user opted in)
  EXPIRED = 'expired', // Product never returned / 30d timeout
  CANCELLED = 'cancelled',
}

@Entity('stock_waitlist')
@Unique(['userId', 'productId', 'variantId', 'type'])
@Index(['productId', 'variantId', 'status'])
@Index(['userId', 'status'])
export class StockWaitlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid')
  productId: string;

  @Column({ type: 'uuid', nullable: true })
  variantId?: string;

  @Column({ type: 'enum', enum: WaitlistType, default: WaitlistType.BACK_IN_STOCK })
  type: WaitlistType;

  @Column({ type: 'enum', enum: WaitlistStatus, default: WaitlistStatus.WAITING })
  status: WaitlistStatus;

  /** For PRICE_DROP — notify when price drops to or below this value (VND) */
  @Column({ type: 'int', nullable: true })
  targetPrice?: number;

  /**
   * Auto-order when stock returns (requires saved payment method).
   * ONLY usable for BACK_IN_STOCK type.
   */
  @Column({ type: 'boolean', default: false })
  autoOrder: boolean;

  /** Quantity to auto-order */
  @Column({ type: 'int', default: 1 })
  quantity: number;

  /** Position in waitlist (set when joining, used for FIFO notification) */
  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  notifiedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;
}
