// ============================================================
// HYPERCOMMERCE — Outbox Event Entity
//
// Transactional Outbox Pattern:
// Events are written to this table IN THE SAME TRANSACTION as
// business data. A separate OutboxProcessor polls for unprocessed
// events and publishes them to Kafka atomically.
//
// This eliminates dual-write risk: if Kafka publish fails,
// the event remains in the table and is retried.
// If the DB transaction rolls back, the event is never published.
// ============================================================

import { Entity, Column, Index, CreateDateColumn, PrimaryColumn } from 'typeorm';

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

@Entity('outbox_events')
@Index(['status', 'createdAt']) // processor scans by status + time
@Index(['aggregateType', 'aggregateId']) // for debugging / replay
export class OutboxEvent {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  /** Domain aggregate type — e.g., 'Order', 'Payment' */
  @Column({ name: 'aggregate_type' })
  aggregateType: string;

  /** ID of the domain aggregate — e.g., orderId, paymentId */
  @Column({ name: 'aggregate_id' })
  aggregateId: string;

  /** Kafka topic to publish to */
  @Column({ type: 'varchar' })
  topic: string;

  /** Optional partition key for Kafka */
  @Column({ name: 'partition_key', nullable: true })
  partitionKey?: string;

  /** Full event payload — serialized JSON */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** Current processing status */
  @Column({
    type: 'enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  @Index()
  status: OutboxEventStatus;

  /** Number of processing attempts */
  @Column({ name: 'attempt_count', default: 0 })
  attemptCount: number;

  /** Last error message (for debugging failed events) */
  @Column({ name: 'last_error', nullable: true, type: 'text' })
  lastError?: string;

  /** When the processor should next attempt this event */
  @Column({ name: 'process_after', type: 'timestamptz', nullable: true })
  processAfter?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date;
}
