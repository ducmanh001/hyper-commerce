import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum ReviewStatus {
  PENDING = 'pending', // Waiting for AI moderation
  APPROVED = 'approved', // Visible to all
  REJECTED = 'rejected', // Hidden — policy violation
  FLAGGED = 'flagged', // AI flagged, needs human review
}

@Entity('reviews')
@Unique(['userId', 'orderId', 'productId']) // One review per purchase per product
@Index(['productId', 'status', 'createdAt']) // Main listing query
@Index(['sellerId', 'status'])
@Index(['userId'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  /** The order that proves this is a verified purchase */
  @Column('uuid')
  orderId: string;

  @Column('uuid')
  productId: string;

  @Column('uuid')
  sellerId: string;

  /** 1 to 5 stars */
  @Column({ type: 'smallint' })
  rating: number;

  /** Review title (optional, max 100 chars) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  title?: string;

  /** Review body (max 2000 chars) */
  @Column({ type: 'text', nullable: true })
  content?: string;

  /** Up to 5 image URLs uploaded by buyer */
  @Column({ type: 'jsonb', default: '[]' })
  images: string[];

  @Column({ type: 'enum', enum: ReviewStatus, default: ReviewStatus.PENDING })
  status: ReviewStatus;

  /** How many users found this review helpful */
  @Column({ type: 'int', default: 0 })
  helpfulCount: number;

  /** AI toxicity score (0-1) from ContentModerationAgent */
  @Column({ type: 'float', nullable: true })
  moderationScore?: number;

  /** Reason for rejection (shown to buyer) */
  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  /** Seller reply text */
  @Column({ type: 'text', nullable: true })
  sellerReply?: string;

  @Column({ type: 'timestamp', nullable: true })
  sellerRepliedAt?: Date;

  /** Whether order.delivered was verified before accepting review */
  @Column({ type: 'boolean', default: false })
  verifiedPurchase: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
