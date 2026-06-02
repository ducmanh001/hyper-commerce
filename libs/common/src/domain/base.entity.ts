/**
 * BaseEntity — Domain Entity Base
 *
 * WHY: Every domain entity needs stable identity across its lifecycle.
 *      Identity persists even when properties change (unlike value objects).
 *
 * PATTERN: Identity Object — entity equality is by ID, not by value.
 *
 * NOTE: This is a PURE domain class — no TypeORM decorators.
 *       ORM-specific concerns belong in infrastructure/persistence/documents/.
 */
import { randomUUID } from 'crypto';

export abstract class BaseEntity {
  /**
   * UUID v4 — globally unique, safe to expose in APIs.
   * Generated on creation; restored from DB on reconstitution.
   */
  readonly id: string;
  readonly createdAt: Date;
  updatedAt: Date;

  protected constructor(id?: string, createdAt?: Date, updatedAt?: Date) {
    this.id = id ?? randomUUID();
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }

  /**
   * Domain equality: two entities are the same if they share the same ID,
   * regardless of their current state.
   */
  equals(other: BaseEntity): boolean {
    if (!(other instanceof BaseEntity)) return false;
    return this.id === other.id;
  }

  /**
   * Mark entity as modified — should be called inside every mutating method
   * so the persistence layer knows to run an UPDATE.
   */
  protected touch(): void {
    this.updatedAt = new Date();
  }
}
