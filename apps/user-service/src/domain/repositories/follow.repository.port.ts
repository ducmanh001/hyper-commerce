/**
 * FollowRepositoryPort — Domain interface for the follow graph
 *
 * The follow graph is a many-to-many relationship: User → Follow → User.
 * It's in its own repository because follow data has different access patterns:
 *   - Writes: O(1) follow/unfollow operations
 *   - Reads: paginated follower/following lists; is-following checks
 *
 * CELEBRITY READS:
 *   getCelebrityFollowerIds is a separate method because for celebrities
 *   we need follower IDs to fan-out read notifications, but for normal
 *   users we never need the full list (just counts).
 */
import type { FollowStatus } from '../types/user.types';

export const FOLLOW_REPOSITORY_PORT = Symbol('FOLLOW_REPOSITORY_PORT');

export interface FollowRecord {
  followerId: string;
  followeeId: string;
  status: FollowStatus;
  createdAt: Date;
}

export interface IFollowRepository {
  /** Create a follow relationship (idempotent — throws AlreadyFollowing if exists). */
  follow(followerId: string, followeeId: string): Promise<void>;

  /** Remove a follow relationship. Noop if not following. */
  unfollow(followerId: string, followeeId: string): Promise<void>;

  /** Check if followerId follows followeeId. O(1) indexed lookup. */
  isFollowing(followerId: string, followeeId: string): Promise<boolean>;

  /** Get a paginated list of who follows userId. */
  getFollowers(
    userId: string,
    params: {
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: FollowRecord[]; nextCursor?: string; totalCount: number }>;

  /** Get a paginated list of who userId follows. */
  getFollowing(
    userId: string,
    params: {
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: FollowRecord[]; nextCursor?: string; totalCount: number }>;

  /**
   * Get ALL follower IDs for a celebrity.
   * Used by feed-service for fan-out-on-read cache warming.
   * NOT paginated — returns full set (celebrities can have millions of followers,
   * but we only call this for background jobs, not per-request).
   */
  getCelebrityFollowerIds(userId: string): Promise<string[]>;

  /** Mutual follow check — do A and B follow each other? */
  areMutualFollowers(userAId: string, userBId: string): Promise<boolean>;

  /** Bulk check: which of targetIds does viewerId follow? */
  getFollowingSubset(viewerId: string, targetIds: string[]): Promise<Set<string>>;
}
