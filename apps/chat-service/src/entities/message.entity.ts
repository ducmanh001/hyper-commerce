import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export enum MessageSenderType {
  BUYER = 'buyer',
  SELLER = 'seller',
  AI = 'ai',
  SYSTEM = 'system',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  ORDER_CARD = 'order_card', // Inline order summary card
  PRODUCT_CARD = 'product_card', // Inline product recommendation
  QUICK_REPLY = 'quick_reply', // AI-suggested quick replies
}

@Entity('chat_messages')
@Index(['conversationId', 'createdAt'])
@Index(['senderId'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column({ type: 'enum', enum: MessageSenderType })
  senderType: MessageSenderType;

  /** null for AI/SYSTEM messages */
  @Column({ type: 'uuid', nullable: true })
  senderId?: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
  messageType: MessageType;

  @Column('text')
  content: string;

  /** Rich payload for ORDER_CARD / PRODUCT_CARD / QUICK_REPLY */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  /** AI model tokens used (for cost tracking) */
  @Column({ type: 'int', nullable: true })
  tokensUsed?: number;

  @CreateDateColumn()
  createdAt: Date;

  /** Soft read receipt */
  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date;
}
