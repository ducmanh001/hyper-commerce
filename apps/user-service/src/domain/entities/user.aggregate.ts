/**
 * UserAggregate — Pure Domain Entity (Aggregate Root)
 *
 * ARCHITECTURE RULES:
 *   - NO TypeORM / framework imports. This is 100% pure TypeScript.
 *   - NO async operations. Domain logic is synchronous.
 *   - All state mutations go through explicit business methods.
 *   - Factory methods (static) + reconstitute() are the only ways to create instances.
 *
 * WHY TWO CREATION PATHS:
 *   UserAggregate.register()       — new user. Emits UserRegisteredEvent.
 *   UserAggregate.reconstitute()   — rebuild from DB. No events emitted.
 *   Never call `new UserAggregate()` directly (enforced by private constructor).
 *
 * CELEBRITY DETECTION:
 *   When followerCount crosses CELEBRITY_THRESHOLD, the fan-out strategy switches:
 *   WRITE: push new posts to all follower feeds immediately (good for regular users)
 *   READ:  followers pull celebrity posts on read (better for 50K+ follower accounts)
 *   This prevents thundering-herd writes when Cristiano Ronaldo posts.
 *
 * DOMAIN INVARIANTS (ALWAYS TRUE):
 *   - email and username are valid (enforced by VOs)
 *   - status is a valid UserStatus
 *   - A DELETED user cannot be activated or have their profile updated
 *   - A SUSPENDED user cannot update their profile
 */
import { BaseAggregateRoot } from '@hypercommerce/common/domain/base.aggregate-root';
import { Email } from '../value-objects/email.vo';
import { Username } from '../value-objects/username.vo';
import type { FanOutStrategy, UserProfileSnapshot } from '../types/user.types';
import { UserStatus, UserRole } from '../types/user.types';
import type { ProfileUpdatePayload } from '../events/user.events';
import {
  UserRegisteredEvent,
  UserProfileUpdatedEvent,
  UserEmailVerifiedEvent,
  UserSuspendedEvent,
  UserDeletedEvent,
} from '../events/user.events';
import {
  UserSuspendedException,
  UserDeletedPermanentlyException,
} from '../exceptions/user.exceptions';

/** Follower count at which fan-out strategy switches from WRITE to READ */
const CELEBRITY_THRESHOLD = 50_000;

// ── Reconstitution props (from persistence) ──────────────────────────────────

export interface UserAggregateProps {
  id: string;
  email: string; // raw string from DB → wrapped in VO internally
  username: string;
  passwordHash: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  status: UserStatus;
  roles: UserRole[];
  emailVerified: boolean;
  phoneVerified: boolean;
  phone?: string;
  sellerId?: string;
  followerCount: number;
  followingCount: number;
  preferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class UserAggregate extends BaseAggregateRoot {
  // ── Private mutable state ──────────────────────────────────────────────────
  private _email: Email;
  private _username: Username;
  private _passwordHash: string;
  private _displayName: string;
  private _avatarUrl?: string;
  private _bio?: string;
  private _status: UserStatus;
  private _roles: UserRole[];
  private _emailVerified: boolean;
  private _phoneVerified: boolean;
  private _phone?: string;
  private _sellerId?: string;
  private _followerCount: number;
  private _followingCount: number;
  private _preferences: Record<string, unknown>;

  // ── Private constructor — use static factories ─────────────────────────────
  private constructor(props: UserAggregateProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._email = new Email(props.email);
    this._username = new Username(props.username);
    this._passwordHash = props.passwordHash;
    this._displayName = props.displayName;
    this._avatarUrl = props.avatarUrl;
    this._bio = props.bio;
    this._status = props.status;
    this._roles = [...props.roles];
    this._emailVerified = props.emailVerified;
    this._phoneVerified = props.phoneVerified;
    this._phone = props.phone;
    this._sellerId = props.sellerId;
    this._followerCount = props.followerCount;
    this._followingCount = props.followingCount;
    this._preferences = props.preferences ?? {};
  }

  // ── Factory: new registration ──────────────────────────────────────────────

  static register(input: {
    email: string;
    username: string;
    passwordHash: string;
    displayName: string;
  }): UserAggregate {
    const now = new Date();
    const user = new UserAggregate({
      id: undefined as unknown as string, // generated in super()
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      status: UserStatus.PENDING_VERIFY,
      roles: [UserRole.USER],
      emailVerified: false,
      phoneVerified: false,
      followerCount: 0,
      followingCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    user.addDomainEvent(
      new UserRegisteredEvent(user.id, input.email, input.username, input.displayName),
    );

    return user;
  }

  // ── Factory: rebuild from persistence (no events emitted) ─────────────────

  static reconstitute(props: UserAggregateProps): UserAggregate {
    return new UserAggregate(props);
  }

  // ── Business Methods ───────────────────────────────────────────────────────

  /**
   * Verify email address — transitions PENDING_VERIFY → ACTIVE
   * Called when user clicks the link in their welcome email.
   */
  verifyEmail(): void {
    if (this._status === UserStatus.DELETED) {
      throw new UserDeletedPermanentlyException(this.id);
    }
    this._emailVerified = true;
    if (this._status === UserStatus.PENDING_VERIFY) {
      this._status = UserStatus.ACTIVE;
    }
    this.touch();
    this.addDomainEvent(new UserEmailVerifiedEvent(this.id, this._email.value));
  }

  /**
   * Update mutable profile fields.
   * SUSPENDED or DELETED users cannot update their profile.
   */
  updateProfile(changes: ProfileUpdatePayload): void {
    this.assertActive('update profile');
    if (changes.displayName !== undefined) this._displayName = changes.displayName;
    if (changes.bio !== undefined) this._bio = changes.bio;
    if (changes.avatarUrl !== undefined) this._avatarUrl = changes.avatarUrl;
    this.touch();
    this.addDomainEvent(new UserProfileUpdatedEvent(this.id, changes));
  }

  /**
   * Increment follower count (denormalized for fast reads).
   * Returns true if this push just crossed the celebrity threshold.
   */
  incrementFollowerCount(): boolean {
    const wasRegular = this._followerCount < CELEBRITY_THRESHOLD;
    this._followerCount += 1;
    this.touch();
    return wasRegular && this._followerCount >= CELEBRITY_THRESHOLD;
  }

  decrementFollowerCount(): void {
    if (this._followerCount > 0) {
      this._followerCount -= 1;
      this.touch();
    }
  }

  incrementFollowingCount(): void {
    this._followingCount += 1;
    this.touch();
  }

  decrementFollowingCount(): void {
    if (this._followingCount > 0) {
      this._followingCount -= 1;
      this.touch();
    }
  }

  /** Admin-only: suspend with audit reason */
  suspend(reason: string, adminId: string): void {
    if (this._status === UserStatus.DELETED) {
      throw new UserDeletedPermanentlyException(this.id);
    }
    this._status = UserStatus.SUSPENDED;
    this.touch();
    this.addDomainEvent(new UserSuspendedEvent(this.id, reason, adminId));
  }

  /** Soft delete — data retained for GDPR compliance window */
  softDelete(): void {
    this._status = UserStatus.DELETED;
    this.touch();
    this.addDomainEvent(new UserDeletedEvent(this.id, this._email.value));
  }

  changePassword(newPasswordHash: string): void {
    this.assertActive('change password');
    this._passwordHash = newPasswordHash;
    this.touch();
  }

  // ── Queries / Getters ──────────────────────────────────────────────────────

  get email(): Email {
    return this._email;
  }
  get username(): Username {
    return this._username;
  }
  get passwordHash(): string {
    return this._passwordHash;
  }
  get displayName(): string {
    return this._displayName;
  }
  get avatarUrl(): string | undefined {
    return this._avatarUrl;
  }
  get bio(): string | undefined {
    return this._bio;
  }
  get status(): UserStatus {
    return this._status;
  }
  get roles(): UserRole[] {
    return [...this._roles];
  }
  get emailVerified(): boolean {
    return this._emailVerified;
  }
  get phoneVerified(): boolean {
    return this._phoneVerified;
  }
  get phone(): string | undefined {
    return this._phone;
  }
  get sellerId(): string | undefined {
    return this._sellerId;
  }
  get followerCount(): number {
    return this._followerCount;
  }
  get followingCount(): number {
    return this._followingCount;
  }
  get preferences(): Record<string, unknown> {
    return { ...this._preferences };
  }

  /** True when followerCount >= CELEBRITY_THRESHOLD */
  get isCelebrity(): boolean {
    return this._followerCount >= CELEBRITY_THRESHOLD;
  }

  /** Determines push vs pull fan-out in feed-service */
  get fanOutStrategy(): FanOutStrategy {
    return this.isCelebrity ? 'READ' : 'WRITE';
  }

  get isActive(): boolean {
    return this._status === UserStatus.ACTIVE;
  }

  /** Snapshot for caching / read model projection */
  toSnapshot(): UserProfileSnapshot {
    return {
      id: this.id,
      username: this._username.value,
      displayName: this._displayName,
      avatarUrl: this._avatarUrl,
      bio: this._bio,
      status: this._status,
      roles: [...this._roles],
      isCelebrity: this.isCelebrity,
      emailVerified: this._emailVerified,
      phoneVerified: this._phoneVerified,
      createdAt: this.createdAt,
    };
  }

  // ── Guard helper ──────────────────────────────────────────────────────────

  private assertActive(action: string): void {
    if (this._status === UserStatus.SUSPENDED) {
      throw new UserSuspendedException(this.id);
    }
    if (this._status === UserStatus.DELETED) {
      throw new UserDeletedPermanentlyException(this.id);
    }
  }
}
