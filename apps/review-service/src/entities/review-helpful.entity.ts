import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from 'typeorm';

/** One "helpful" vote per user per review — idempotent */
@Entity('review_helpfuls')
@Unique(['reviewId', 'userId'])
@Index(['reviewId'])
export class ReviewHelpful {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  reviewId: string;

  @Column('uuid')
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
