import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * UserProfile — extended profile data.
 * Separated from User entity for:
 * 1. Performance: User (auth) is loaded often; Profile (display) less so
 * 2. Different update patterns: User changes rarely; Profile changes often
 */
@Entity('user_profiles')
@Index(['userId'], { unique: true })
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, unique: true })
  userId!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  displayName?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  aboutMe?: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  websiteUrl?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  city?: string;

  @Column({ type: 'date', nullable: true })
  birthDate?: Date;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';

  @Column({ type: 'simple-array', nullable: true })
  interests?: string[];  // Product categories user is interested in

  @Column({ type: 'varchar', length: 1000, nullable: true })
  coverImageUrl?: string;

  @Column({ type: 'jsonb', nullable: true })
  socialLinks?: Record<string, string>;  // { facebook: url, tiktok: url }

  @Column({ type: 'boolean', default: true })
  profilePublic!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
