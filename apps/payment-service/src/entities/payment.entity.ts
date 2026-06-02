import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type PaymentStatus =
  | 'PENDING'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

@Entity('payments')
@Index(['orderId'])
@Index(['userId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'bigint' })
  amount!: number;  // in smallest currency unit

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: PaymentStatus;

  @Column({ type: 'varchar', length: 30 })
  processorType!: string;  // CARD | WALLET | COD

  @Column({ type: 'varchar', length: 200, default: '' })
  processorReference!: string;  // Stripe PaymentIntent ID etc.

  @Column({ type: 'bigint', default: 0 })
  refundedAmount!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  failureCode?: string;

  @Column({ type: 'varchar', length: 200, nullable: true, unique: true })
  @Index()
  idempotencyKey?: string;

  @Column({ type: 'timestamp', nullable: true })
  capturedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
