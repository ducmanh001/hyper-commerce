/**
 * Username Value Object
 *
 * DOMAIN RULES:
 *   1. 3–50 characters
 *   2. Only: letters, digits, underscores, hyphens (like Twitter/GitHub)
 *   3. Cannot start or end with underscore/hyphen
 *   4. Case-insensitive for uniqueness check (stored lowercase)
 *   5. Cannot be a reserved word (admin, root, api, etc.)
 *
 * WHY NOT just a @IsUsername() decorator?
 *   Class-validator decorators run at the HTTP boundary (DTO validation).
 *   Value Objects run at the domain boundary — even if a username arrives
 *   via Kafka or gRPC (not HTTP), the rules still apply.
 */
import { BaseValueObject } from '@hypercommerce/common/domain/base.value-object';

interface UsernameProps {
  value: string;
}

export class Username extends BaseValueObject<UsernameProps> {
  private static readonly PATTERN = /^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$|^[a-z0-9]{3}$/;
  private static readonly MIN_LENGTH = 3;
  private static readonly MAX_LENGTH = 50;

  /** Reserved words that cannot be used as usernames */
  private static readonly RESERVED = new Set([
    'admin',
    'root',
    'api',
    'www',
    'app',
    'mail',
    'email',
    'support',
    'help',
    'info',
    'user',
    'users',
    'account',
    'accounts',
    'login',
    'logout',
    'register',
    'signup',
    'profile',
    'settings',
    'null',
    'undefined',
    'anonymous',
    'system',
    'bot',
    'hypercommerce',
  ]);

  constructor(rawUsername: string) {
    super({ value: (rawUsername ?? '').toLowerCase().trim() });
  }

  protected validate({ value }: UsernameProps): void {
    if (!value) {
      throw new Error('Username cannot be empty');
    }
    if (value.length < Username.MIN_LENGTH) {
      throw new Error(`Username must be at least ${Username.MIN_LENGTH} characters`);
    }
    if (value.length > Username.MAX_LENGTH) {
      throw new Error(`Username cannot exceed ${Username.MAX_LENGTH} characters`);
    }
    if (!Username.PATTERN.test(value)) {
      throw new Error(
        `Username can only contain letters, digits, underscores, and hyphens, ` +
          `and cannot start or end with an underscore or hyphen`,
      );
    }
    if (Username.RESERVED.has(value)) {
      throw new Error(`"${value}" is a reserved username`);
    }
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
