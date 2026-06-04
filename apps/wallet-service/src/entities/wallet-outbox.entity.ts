import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

export type OutboxStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

@Entity('wallet_outbox_events')
@Index(['status', 'createdAt'])
export class WalletOutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 50 })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 100 })
  topic!: string;

  @Column({ name: 'partition_key', type: 'varchar', length: 100, nullable: true })
  partitionKey?: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  @Index()
  status!: OutboxStatus;

  @Column({ name: 'attempt_count', type: 'smallint', default: 0 })
  attemptCount!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date;
}
