/**
 * Domain Events for the User aggregate
 *
 * NAMING RULE: Past tense noun phrase. Something that HAPPENED.
 *   ✓ UserRegistered, UserProfileUpdated, UserFollowed
 *   ✗ RegisterUser, UpdateProfile (those are commands)
 *
 * WHAT TO INCLUDE IN EVENTS:
 *   Include enough data for consumers to act WITHOUT querying back.
 *   E.g., UserRegistered includes email so notification-service can send
 *   a welcome email without doing a GET /users/:id round-trip.
 *
 * WHAT NOT TO INCLUDE:
 *   - Sensitive data (password hashes, raw tokens)
 *   - Derived/computed data (follower count at time of event — that's a read model)
 *
 * CONSUMERS:
 *   UserRegistered      → notification-service (welcome email), analytics-service (funnel)
 *   UserProfileUpdated  → search-service (re-index user), feed-service (propagate avatar change)
 *   UserFollowed        → feed-service (add posts to follower's feed or mark celebrity pull)
 *   UserUnfollowed      → feed-service (prune follower's feed)
 *   UserSuspended       → auth-service (invalidate tokens), notification-service (alert)
 */
import { DomainEvent } from '@hypercommerce/common/domain/domain-event.base';

// ── User Registered ──────────────────────────────────────────────────────────

export class UserRegisteredEvent extends DomainEvent {
  readonly eventType = 'user.registered';

  constructor(
    readonly aggregateId: string,  // userId
    readonly email: string,
    readonly username: string,
    readonly displayName: string,
  ) {
    super();
  }
}

// ── Profile Updated ──────────────────────────────────────────────────────────

export interface ProfileUpdatePayload {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

export class UserProfileUpdatedEvent extends DomainEvent {
  readonly eventType = 'user.profile_updated';

  constructor(
    readonly aggregateId: string,
    readonly changes: ProfileUpdatePayload,
  ) {
    super();
  }
}

// ── Email Verified ────────────────────────────────────────────────────────────

export class UserEmailVerifiedEvent extends DomainEvent {
  readonly eventType = 'user.email_verified';

  constructor(
    readonly aggregateId: string,
    readonly email: string,
  ) {
    super();
  }
}

// ── Follow ────────────────────────────────────────────────────────────────────

export class UserFollowedEvent extends DomainEvent {
  readonly eventType = 'user.followed';

  constructor(
    readonly aggregateId: string, // followerId
    readonly followeeId: string,
    readonly followeeIsCelebrity: boolean,
  ) {
    super();
  }
}

export class UserUnfollowedEvent extends DomainEvent {
  readonly eventType = 'user.unfollowed';

  constructor(
    readonly aggregateId: string, // followerId
    readonly followeeId: string,
  ) {
    super();
  }
}

// ── Status changes ────────────────────────────────────────────────────────────

export class UserSuspendedEvent extends DomainEvent {
  readonly eventType = 'user.suspended';

  constructor(
    readonly aggregateId: string,
    readonly reason: string,
    readonly suspendedByAdminId: string,
  ) {
    super();
  }
}

export class UserDeletedEvent extends DomainEvent {
  readonly eventType = 'user.deleted';

  constructor(
    readonly aggregateId: string,
    readonly email: string,  // For data retention/GDPR audits
  ) {
    super();
  }
}
