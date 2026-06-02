/**
 * UserTypes — All type definitions for the User domain
 *
 * WHY SEPARATE FILE:
 *   Types, enums and interfaces are used across domain/application/infrastructure layers.
 *   Putting them in a dedicated file avoids circular imports
 *   and makes it easy to find "what types exist in this domain".
 *
 * RULE: No framework imports here (no @nestjs, no typeorm, no class-validator).
 *       This file must be importable in any context including unit tests.
 */

// ── User lifecycle states ───────────────────────────────────────────────────

export enum UserStatus {
  /** Normal active account */
  ACTIVE = 'ACTIVE',

  /** Email submitted but not yet verified */
  PENDING_VERIFY = 'PENDING_VERIFY',

  /** Manually suspended by admin — cannot login */
  SUSPENDED = 'SUSPENDED',

  /** Soft-deleted — data retained for 30 days, then purged */
  DELETED = 'DELETED',
}

// ── Roles & Permissions ─────────────────────────────────────────────────────

export enum UserRole {
  USER       = 'USER',
  SELLER     = 'SELLER',   // Can list products, manage orders
  MODERATOR  = 'MODERATOR', // Can remove posts, suspend accounts
  ADMIN      = 'ADMIN',    // Full access
}

// ── Social graph ────────────────────────────────────────────────────────────

export enum FollowStatus {
  /** A follows B */
  FOLLOWING = 'FOLLOWING',

  /** A blocked B — neither can see each other */
  BLOCKED = 'BLOCKED',
}

// ── Social stats ─────────────────────────────────────────────────────────────

export interface SocialStats {
  followerCount:  number;
  followingCount: number;
  postCount:      number;
  /**
   * Celebrity threshold: followerCount >= 50,000 triggers fan-out strategy change.
   * Regular users: write to follower feeds on post (fan-out on write).
   * Celebrities:   pull from their post list at read time (fan-out on read).
   */
  isCelebrity: boolean;
}

// ── Fan-out strategy ─────────────────────────────────────────────────────────

export type FanOutStrategy = 'WRITE' | 'READ';

// ── Profile ─────────────────────────────────────────────────────────────────

export interface UserProfileSnapshot {
  id:            string;
  username:      string;
  displayName:   string;
  avatarUrl?:    string;
  bio?:          string;
  status:        UserStatus;
  roles:         UserRole[];
  isCelebrity:   boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt:     Date;
}
