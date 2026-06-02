import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { OrderItem } from './order-item.entity';

export type OrderStatus =
  | 'PENDING'
  | 'STOCK_RESERVED'
  | 'PAYMENT_PROCESSING'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'DISPUTED';

@Entity('orders')
@Index(['userId', 'createdAt'])
@Index(['status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Citus shard key — all queries include userId to stay on same shard */
  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  sellerId?: string;

  @Column({ type: 'varchar', length: 50 })
  status!: OrderStatus;

  @Column({ type: 'bigint' })
  totalAmount!: number;  // in smallest currency unit (VND, cents)

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  paymentMethod?: string;

  @Column({ type: 'jsonb', nullable: true })
  shippingAddress?: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  /** Optimistic locking — prevents concurrent state transitions */
  @VersionColumn()
  version!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index({ unique: true, where: '"idempotencyKey" IS NOT NULL' })
  idempotencyKey?: string;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'text', nullable: true })
  cancellationReason?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  cancelledBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  refundedAt?: Date;

  @OneToMany(() => OrderItem, (item) => item.orderId, { eager: false })
  items!: OrderItem[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
