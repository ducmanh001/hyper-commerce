/**
 * User Query Handlers — read-optimized responses with caching
 *
 * READ MODEL PATTERN:
 *   Queries don't load domain aggregates (expensive, full behavior).
 *   They use the cache first (L1 Redis), then DB (L2), and return DTOs
 *   shaped for the UI — not domain objects.
 *
 * VIEWER CONTEXT:
 *   GetUserProfileQuery includes optional viewerId.
 *   If viewerId is provided, we enrich the response with:
 *   - isFollowing: does viewer follow this user?
 *   - isMutualFollower: do they follow each other?
 *   This avoids a separate API call from the client.
 */
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';
import {
  GetUserProfileQuery,
  GetFollowersQuery,
  GetFollowingQuery,
  SearchUsersQuery,
  CheckUsernameAvailabilityQuery,
} from './user.queries';
import {
  USER_REPOSITORY_PORT, IUserRepository,
} from '../../domain/repositories/user.repository.port';
import {
  FOLLOW_REPOSITORY_PORT, IFollowRepository,
} from '../../domain/repositories/follow.repository.port';
import {
  USER_CACHE_PORT, IUserCachePort,
} from '../ports/application.ports';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { Username } from '../../domain/value-objects/username.vo';

const PROFILE_CACHE_TTL_SEC = 300; // 5 minutes

// ── GetUserProfile ────────────────────────────────────────────────────────────

@QueryHandler(GetUserProfileQuery)
export class GetUserProfileHandler implements IQueryHandler<GetUserProfileQuery> {
  private readonly logger = new Logger(GetUserProfileHandler.name);

  constructor(
    @Inject(USER_REPOSITORY_PORT)   private readonly userRepo: IUserRepository,
    @Inject(USER_CACHE_PORT)        private readonly cache: IUserCachePort,
    @Inject(FOLLOW_REPOSITORY_PORT) private readonly followRepo: IFollowRepository,
  ) {}

  async execute(query: GetUserProfileQuery) {
    // ── L1: Redis cache ────────────────────────────────────────────────────
    const cached = await this.cache.getProfile(query.userId);
    if (cached) {
      return this.enrichWithViewerContext(cached, query.viewerId);
    }

    // ── L2: Database ───────────────────────────────────────────────────────
    const user = await this.userRepo.findById(query.userId);
    if (!user) throw new UserNotFoundException(query.userId);

    const snapshot = user.toSnapshot();

    // Write-back to cache
    await this.cache.setProfile(
      query.userId,
      snapshot as unknown as Record<string, unknown>,
      PROFILE_CACHE_TTL_SEC,
    );

    return this.enrichWithViewerContext(snapshot as unknown as Record<string, unknown>, query.viewerId);
  }

  private async enrichWithViewerContext(profile: Record<string, unknown>, viewerId?: string) {
    if (!viewerId || viewerId === profile['id']) {
      return { ...profile, isFollowing: false, isMutualFollower: false, isOwnProfile: !viewerId || viewerId === profile['id'] };
    }

    const [isFollowing, isMutualFollower] = await Promise.all([
      this.followRepo.isFollowing(viewerId, profile['id'] as string),
      this.followRepo.areMutualFollowers(viewerId, profile['id'] as string),
    ]);

    return { ...profile, isFollowing, isMutualFollower, isOwnProfile: false };
  }
}

// ── GetFollowers ──────────────────────────────────────────────────────────────

@QueryHandler(GetFollowersQuery)
export class GetFollowersHandler implements IQueryHandler<GetFollowersQuery> {
  constructor(
    @Inject(FOLLOW_REPOSITORY_PORT) private readonly followRepo: IFollowRepository,
    @Inject(USER_REPOSITORY_PORT)   private readonly userRepo: IUserRepository,
  ) {}

  async execute(query: GetFollowersQuery) {
    const { items, nextCursor, totalCount } = await this.followRepo.getFollowers(
      query.userId, { limit: query.limit, cursor: query.cursor },
    );

    // Hydrate follower profiles (batch fetch)
    const followerIds = items.map((f) => f.followerId);
    const users = await this.userRepo.findByIds(followerIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      items: items.map((f) => {
        const u = userMap.get(f.followerId);
        return u ? { id: u.id, username: u.username.value, displayName: u.displayName, avatarUrl: u.avatarUrl, isCelebrity: u.isCelebrity } : null;
      }).filter(Boolean),
      totalCount,
      nextCursor,
    };
  }
}

// ── GetFollowing ──────────────────────────────────────────────────────────────

@QueryHandler(GetFollowingQuery)
export class GetFollowingHandler implements IQueryHandler<GetFollowingQuery> {
  constructor(
    @Inject(FOLLOW_REPOSITORY_PORT) private readonly followRepo: IFollowRepository,
    @Inject(USER_REPOSITORY_PORT)   private readonly userRepo: IUserRepository,
  ) {}

  async execute(query: GetFollowingQuery) {
    const { items, nextCursor, totalCount } = await this.followRepo.getFollowing(
      query.userId, { limit: query.limit, cursor: query.cursor },
    );
    const followeeIds = items.map((f) => f.followeeId);
    const users       = await this.userRepo.findByIds(followeeIds);
    const userMap     = new Map(users.map((u) => [u.id, u]));

    return {
      items: items.map((f) => {
        const u = userMap.get(f.followeeId);
        return u ? { id: u.id, username: u.username.value, displayName: u.displayName, avatarUrl: u.avatarUrl, isCelebrity: u.isCelebrity } : null;
      }).filter(Boolean),
      totalCount,
      nextCursor,
    };
  }
}

// ── SearchUsers ───────────────────────────────────────────────────────────────

@QueryHandler(SearchUsersQuery)
export class SearchUsersHandler implements IQueryHandler<SearchUsersQuery> {
  constructor(
    @Inject(USER_REPOSITORY_PORT) private readonly userRepo: IUserRepository,
  ) {}

  async execute(query: SearchUsersQuery) {
    return this.userRepo.search({
      query:  query.query,
      limit:  query.limit,
      cursor: query.cursor,
    });
  }
}

// ── CheckUsernameAvailability ─────────────────────────────────────────────────

@QueryHandler(CheckUsernameAvailabilityQuery)
export class CheckUsernameAvailabilityHandler implements IQueryHandler<CheckUsernameAvailabilityQuery> {
  constructor(
    @Inject(USER_REPOSITORY_PORT) private readonly userRepo: IUserRepository,
  ) {}

  async execute(query: CheckUsernameAvailabilityQuery) {
    try {
      const username = new Username(query.username);
      const taken = await this.userRepo.existsByUsername(username);
      return { available: !taken, username: username.value };
    } catch {
      // Invalid username format → not available
      return { available: false, username: query.username };
    }
  }
}
