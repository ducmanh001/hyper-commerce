import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED',
  ENDED = 'ENDED',
}

export enum CampaignType {
  SPONSORED_PRODUCT = 'SPONSORED_PRODUCT', // Search result + feed injection
  BANNER = 'BANNER', // Homepage banner
  CATEGORY_TOP = 'CATEGORY_TOP', // Top of category listing
}

export enum BiddingModel {
  CPC = 'CPC', // Cost-per-click (default, performance-based)
  CPM = 'CPM', // Cost-per-mille/thousand impressions (brand awareness)
}

@Entity('ad_campaigns')
@Index(['sellerId', 'status'])
@Index(['status', 'startAt', 'endAt'])
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sellerId: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: CampaignType, default: CampaignType.SPONSORED_PRODUCT })
  type: CampaignType;

  @Column({ type: 'enum', enum: BiddingModel, default: BiddingModel.CPC })
  biddingModel: BiddingModel;

  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  // Total budget in VND (campaign lifetime)
  @Column({ type: 'bigint' })
  totalBudget: number;

  // Daily budget cap in VND — prevents overspending in one day
  @Column({ type: 'bigint', nullable: true })
  dailyBudget: number | null;

  // Amount spent so far (updated async by billing job)
  @Column({ type: 'bigint', default: 0 })
  totalSpent: number;

  @Column({ type: 'bigint', default: 0 })
  dailySpent: number;

  // Max bid per click/impression in VND
  @Column({ type: 'int' })
  maxBidVnd: number;

  // Keywords to target (for SPONSORED_PRODUCT)
  // Stored as text array; Postgres GIN index for fast lookup
  @Column({ type: 'text', array: true, default: [] })
  targetKeywords: string[];

  // Product IDs being advertised
  @Column({ type: 'text', array: true, default: [] })
  productIds: string[];

  // Category targeting
  @Column({ type: 'text', array: true, default: [], nullable: true })
  targetCategories: string[] | null;

  @Column({ type: 'timestamptz', nullable: true })
  startAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endAt: Date | null;

  // Metrics (updated by aggregation job)
  @Column({ type: 'int', default: 0 }) impressions: number;
  @Column({ type: 'int', default: 0 }) clicks: number;
  @Column({ type: 'int', default: 0 }) orders: number;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
