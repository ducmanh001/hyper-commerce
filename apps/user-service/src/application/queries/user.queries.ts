/**
 * Queries for the User domain
 *
 * CQRS Query: read-only operations.
 * Queries DON'T use the domain aggregate — they query projections/read models
 * that are optimized for display (denormalized, joined, paginated).
 *
 * WHY SEPARATE from Commands:
 *   Commands: change state, use domain aggregates, validate invariants
 *   Queries:  read state, can bypass domain, optimized for read performance
 *
 *   This lets us have a fast read path (Redis cache → DB projection)
 *   without loading and reconstituting the full domain aggregate.
 */

export class GetUserProfileQuery {
  constructor(
    public readonly userId: string,
    /** The person viewing — used to add "isFollowing" context */
    public readonly viewerId?: string,
  ) {}
}

export class GetFollowersQuery {
  constructor(
    public readonly userId: string,
    public readonly limit: number,
    public readonly cursor?: string,
  ) {}
}

export class GetFollowingQuery {
  constructor(
    public readonly userId: string,
    public readonly limit: number,
    public readonly cursor?: string,
  ) {}
}

export class SearchUsersQuery {
  constructor(
    public readonly query: string,
    public readonly limit: number,
    public readonly cursor?: string,
  ) {}
}

export class CheckUsernameAvailabilityQuery {
  constructor(public readonly username: string) {}
}
