import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ConversationType {
  AI_SUPPORT = 'ai_support', // Buyer ↔ AI assistant
  BUYER_SELLER = 'buyer_seller', // Buyer ↔ Seller direct message
  ORDER_SUPPORT = 'order_support', // Auto-opened for disputed orders
}

export enum ConversationStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  ESCALATED = 'escalated', // Escalated to human agent
}

@Entity('conversations')
@Index(['buyerId'])
@Index(['sellerId'])
@Index(['orderId'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ConversationType })
  type: ConversationType;

  @Column({ type: 'enum', enum: ConversationStatus, default: ConversationStatus.OPEN })
  status: ConversationStatus;

  @Column('uuid')
  buyerId: string;

  @Column({ type: 'uuid', nullable: true })
  sellerId?: string;

  /** Linked order (for order_support type) */
  @Column({ type: 'uuid', nullable: true })
  orderId?: string;

  /** AI conversation memory — last 20 messages kept for context window */
  @Column({ type: 'jsonb', default: '[]' })
  aiContext: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;

  /** Count unread messages for buyer */
  @Column({ type: 'int', default: 0 })
  buyerUnreadCount: number;

  /** Count unread messages for seller */
  @Column({ type: 'int', default: 0 })
  sellerUnreadCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
