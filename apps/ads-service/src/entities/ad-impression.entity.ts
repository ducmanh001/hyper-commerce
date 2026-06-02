import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// AdImpression: one record per ad shown to a user
// Stored in ClickHouse for high-volume analytics; PostgreSQL copy is event log only
@Entity('ad_impressions')
@Index(['campaignId', 'createdAt'])
@Index(['adId', 'createdAt'])
export class AdImpression {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  campaignId: string;

  @Column({ type: 'uuid' })
  adId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ length: 64, nullable: true })
  sessionId: string | null;

  // The query/context that triggered this impression
  @Column({ length: 500, nullable: true })
  keyword: string | null;

  // Position in the list (1 = top)
  @Column({ type: 'int', default: 1 })
  position: number;

  // Cost-per-mille fee charged if CPM model
  @Column({ type: 'int', nullable: true })
  cpmFeeVnd: number | null;

  // True once the user clicked (denormalized for fast lookup)
  @Column({ type: 'boolean', default: false })
  clicked: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  clickedAt: Date | null;

  @CreateDateColumn() createdAt: Date;
}
