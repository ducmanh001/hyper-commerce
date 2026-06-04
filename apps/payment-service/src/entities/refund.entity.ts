import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('refunds')
@Index(['paymentId'])
@Index(['orderId'])
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  paymentId!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Column({ type: 'bigint' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 50, default: 'PENDING_REFUND' })
  status!: 'PENDING_REFUND' | 'REFUNDED' | 'FAILED';

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  refundReference?: string; // Processor refund ID

  @Column({ type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
