/**
 * FeatureFlag entity
 *
 * Runtime feature toggles — no redeployment required.
 * Supports: boolean on/off, percentage rollout, per-seller, per-user,
 * and environment-based targeting.
 *
 * Evaluation order:
 *   1. Disabled globally → false
 *   2. User in allowedUserIds → true
 *   3. Seller in allowedSellerIds → true
 *   4. Percentage rollout (deterministic hash of userId) → true/false
 *   5. Enabled globally → true
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Unique slug — used in @FeatureGate('my-feature') */
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index({ unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  description!: string;

  /** Master switch */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /**
   * Percentage of users who see this feature (0–100).
   * 0 = no one; 100 = everyone who passes environment check.
   * Deterministic: same userId always gets the same outcome.
   */
  @Column({ type: 'int', default: 100 })
  rolloutPercent!: number;

  /** Environments where this flag is active (e.g. ['production', 'staging']) */
  @Column({ type: 'simple-array', nullable: true })
  environments?: string[];

  /** Explicit allowlist — these users always get the feature */
  @Column({ type: 'simple-array', nullable: true })
  allowedUserIds?: string[];

  /** Explicit allowlist — these sellers always get the feature */
  @Column({ type: 'simple-array', nullable: true })
  allowedSellerIds?: string[];

  /** Owner team / service responsible for cleaning this flag up */
  @Column({ type: 'varchar', length: 50, nullable: true })
  owner?: string;

  /** Planned expiry date — stale flags are flagged in the admin dashboard */
  @Column({ type: 'date', nullable: true })
  expiresAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
