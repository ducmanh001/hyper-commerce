import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type NotificationStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

@Entity('notifications')
@Index(['userId', 'createdAt'])
@Index(['status'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', array: true, default: [] })
  channels!: string[];

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: NotificationStatus;

  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, string>;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
