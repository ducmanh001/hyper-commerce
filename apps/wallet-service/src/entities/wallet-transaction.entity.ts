import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type TransactionType =
  | 'TOPUP'
  | 'WITHDRAW'
  | 'GIFT_SEND'
  | 'GIFT_RECEIVE'
  | 'CASHBACK'
  | 'PAYOUT';

@Entity('wallet_transactions')
@Index(['userId', 'createdAt'])
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: TransactionType;

  /** Amount in VND dong — positive = credit, negative = debit */
  @Column({ type: 'bigint' })
  amount!: number;

  /** Balance snapshot after this transaction — source of truth for balance */
  @Column({ name: 'balance_after', type: 'bigint' })
  balanceAfter!: number;

  /** Reference ID: orderId | giftEventId | payoutId */
  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId?: string;

  /** Extra context: cashback_rate, gift_type, etc. */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
