/**
 * Email Value Object
 *
 * WHAT: Wraps a raw email string and enforces all domain rules at construction time.
 *
 * WHY VALUE OBJECT (not primitive string):
 *   - A plain string can be anything: "", "not-an-email", "HELLO@GMAIL.COM"
 *   - With a VO, if you hold an `Email` instance, it IS a valid, normalized email.
 *   - No need to re-validate in every function that receives an email.
 *
 * DOMAIN RULES:
 *   1. Must match RFC 5321 simplified pattern
 *   2. Normalized to lowercase (HELLO@GMAIL.COM ≡ hello@gmail.com)
 *   3. Trimmed (no leading/trailing spaces)
 *   4. Max 255 characters (SMTP standard)
 *
 * USAGE:
 *   const email = new Email('HELLO@Gmail.com');  // normalizes automatically
 *   email.value   // "hello@gmail.com"
 *   email.domain  // "gmail.com"
 *   email.equals(new Email('hello@gmail.com'))  // true
 *
 * ANTI-PATTERN:
 *   DON'T: async function register(email: string) { if (!isEmail(email)) throw ... }
 *   DO:    async function register(email: Email) { /* email is always valid *\/ }
 */
import { BaseValueObject } from '@hypercommerce/common/domain/base.value-object';

interface EmailProps {
  value: string;
}

export class Email extends BaseValueObject<EmailProps> {
  /**
   * RFC 5321 simplified — handles 99%+ of real email addresses.
   * Deliberately NOT RFC 5322 full (which allows weird things like "John"@example.com).
   */
  private static readonly PATTERN =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  private static readonly MAX_LENGTH = 255;

  constructor(rawEmail: string) {
    // Normalize before validation
    super({ value: (rawEmail ?? '').toLowerCase().trim() });
  }

  protected validate({ value }: EmailProps): void {
    if (!value) {
      throw new Error('Email cannot be empty');
    }
    if (value.length > Email.MAX_LENGTH) {
      throw new Error(`Email exceeds ${Email.MAX_LENGTH} character limit`);
    }
    if (!Email.PATTERN.test(value)) {
      throw new Error(`"${value}" is not a valid email address`);
    }
  }

  get value(): string {
    return this.props.value;
  }

  /** The part after @: "user@gmail.com" → "gmail.com" */
  get domain(): string {
    return this.props.value.split('@')[1];
  }

  /** The local-part before @: "user@gmail.com" → "user" */
  get localPart(): string {
    return this.props.value.split('@')[0];
  }

  override toString(): string {
    return this.props.value;
  }
}
