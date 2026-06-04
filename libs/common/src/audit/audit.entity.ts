/**
 * AuditLog TypeORM entity
 *
 * Why append-only? Audit logs must be tamper-evident.
 * No UPDATE or DELETE is ever issued on this table — only INSERTs.
 * In production: enable PostgreSQL row-level security to prevent even
 * DB admins from deleting rows without a special privileged role.
 *
 * Storage tip: partition by month in PostgreSQL:
 *   CREATE TABLE audit_logs PARTITION BY RANGE (created_at);
 */

import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

export type AuditAction =
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'APPROVE'
  | 'REJECT'
  | 'BAN'
  | 'UNBAN'
  | 'REFUND'
  | 'PAYOUT'
  | 'EXPORT'
  | 'IMPERSONATE'
  | 'CONFIGURE';

@Entity('audit_logs')
@Index(['actorId', 'createdAt'])
@Index(['resource', 'resourceId'])
@Index(['action', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Who performed the action */
  @Column({ type: 'varchar', length: 36 })
  @Index()
  actorId!: string;

  @Column({ type: 'varchar', length: 100 })
  actorEmail!: string;

  @Column({ type: 'varchar', length: 50 })
  actorRole!: string;

  /** What action was performed */
  @Column({ type: 'varchar', length: 30 })
  action!: AuditAction;

  /** Which resource type (e.g. 'User', 'Order') */
  @Column({ type: 'varchar', length: 50 })
  resource!: string;

  /** The specific resource ID that was affected */
  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceId?: string;

  /** Diff / payload snapshot — JSONB for queryability */
  @Column({ type: 'jsonb', nullable: true })
  changes?: Record<string, unknown>;

  /** HTTP metadata */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ type: 'text', nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  traceId?: string;

  /** Outcome */
  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
