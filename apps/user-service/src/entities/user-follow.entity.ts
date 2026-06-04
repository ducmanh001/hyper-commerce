import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * UserFollow — edge in social graph.
 *
 * Fan-out strategy depends on follower count:
 * - Regular user (< 10k followers): write fan-out (push to all followers' feeds)
 * - Celebrity (>= 10k followers): read fan-out (pull at read time)
 *
 * The celebrity-detector.helper.ts handles this decision.
 */
@Entity('user_follows')
@Index(['followerId', 'followeeId'], { unique: true })
@Index(['followeeId']) // "who follows this person" — for fan-out
@Index(['followerId']) // "who does this person follow" — for feed
export class UserFollow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  followerId!: string; // The person who clicked Follow

  @Column({ type: 'varchar', length: 36 })
  followeeId!: string; // The person being followed

  @Column({ type: 'boolean', default: false })
  notificationsEnabled!: boolean; // Notify on new content

  @CreateDateColumn()
  createdAt!: Date;
}
