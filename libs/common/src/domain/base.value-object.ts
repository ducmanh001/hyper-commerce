/**
 * BaseValueObject — Immutable Value Object Base
 *
 * WHY: Value objects model domain concepts that are defined by their ATTRIBUTES,
 *      not by a unique identity. Two Emails are equal if they have the same string.
 *
 * PROPERTIES:
 *   1. Immutable — props are frozen after construction.
 *   2. Self-validating — constructor throws if invariants are violated.
 *   3. Value equality — equals() compares prop values, not references.
 *   4. Side-effect-free — methods return new VOs, they don't mutate.
 *
 * EXAMPLES: Email, Username, Money, Address, PhoneNumber, Password.
 *
 * ANTI-PATTERN: DON'T use VOs for entities that have identity (User, Order, etc.)
 */
export abstract class BaseValueObject<T extends object> {
  /**
   * Frozen at construction time — cannot be mutated after.
   * TypeScript `readonly` is not enough; Object.freeze is runtime enforcement.
   */
  protected readonly props: Readonly<T>;

  protected constructor(props: T) {
    // Validate BEFORE freezing so we throw with mutable state accessible
    this.validate(props);
    this.props = Object.freeze({ ...props });
  }

  /**
   * Domain invariant enforcement.
   * Called before freezing — throw Error/domain exceptions if invalid.
   */
  protected abstract validate(props: T): void;

  /**
   * Structural equality — two VOs are equal when all props match.
   * Handles nested objects via deep JSON comparison.
   * For performance-critical hot paths, override with specific comparison.
   */
  equals(other: BaseValueObject<T>): boolean {
    if (!(other instanceof this.constructor)) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  /**
   * Allow VO to serialize itself for logging/debugging.
   * Subclasses should override with a meaningful representation.
   */
  toString(): string {
    return JSON.stringify(this.props);
  }
}
