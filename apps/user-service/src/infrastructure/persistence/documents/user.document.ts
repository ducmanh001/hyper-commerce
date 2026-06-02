/**
 * UserDocument — TypeORM Entity (Infrastructure Layer)
 *
 * WHY SEPARATE FROM DOMAIN ENTITY:
 *   The domain entity (UserAggregate) is 100% pure business logic.
 *   This document carries TypeORM decorators and is the ORM's concern.
 *
 *   Separation benefits:
 *   1. Domain can evolve without ORM migration
 *   2. ORM schema can change (add columns, rename) without touching domain
 *   3. Domain unit tests don't need TypeORM loaded
 *
 * NAMING: "Document" (vs "Entity") signals this is infrastructure, not domain.
 *   Some teams call it UserOrmEntity, UserRow, UserRecord — pick one, be consistent.
 *
 * MAPPING: UserMapper converts Document ↔ UserAggregate.
 */
import {
  Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

@Entity('users')
@Index(['email'],    { unique: true })
@Index(['username'], { unique: true })
@Index(['status'])
export class UserDocument {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 50 })
  username!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100 })
  displayName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl?: string;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING_VERIFY' })
  status!: string;

  @Column({ type: 'simple-array', default: 'USER' })
  roles!: string[];

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'boolean', default: false })
  phoneVerified!: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'uuid', nullable: true })
  sellerId?: string;

  /**
   * Denormalized counter — kept consistent by FollowUserHandler.
   * Avoids a COUNT(*) query on every profile load.
   */
  @Column({ type: 'int', default: 0 })
  followerCount!: number;

  @Column({ type: 'int', default: 0 })
  followingCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  preferences?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
