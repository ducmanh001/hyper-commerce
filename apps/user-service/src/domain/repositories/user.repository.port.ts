/**
 * UserRepositoryPort — Domain repository interface (dependency inversion)
 *
 * WHY THIS PATTERN:
 *   The domain layer defines WHAT it needs (this interface).
 *   The infrastructure layer provides HOW it works (TypeORM/MongoDB implementation).
 *
 *   This is the "D" in SOLID — Dependency Inversion Principle.
 *   Domain depends on ABSTRACTIONS, not on TypeORM.
 *
 *   Benefits:
 *   1. Easy to test: mock this interface, no real DB needed
 *   2. Easy to swap: replace TypeORM with Prisma → only change infrastructure layer
 *   3. Domain stays pure: no ORM decorators, no SQL leaking into domain
 *
 * INJECTION TOKEN:
 *   Use the string token (USER_REPOSITORY_PORT) instead of the interface itself,
 *   because TypeScript interfaces are erased at runtime.
 *
 * USAGE in command handler:
 *   @Inject(USER_REPOSITORY_PORT) private readonly repo: IUserRepository
 */
import type { UserAggregate } from '../entities/user.aggregate';
import type { Email } from '../value-objects/email.vo';
import type { Username } from '../value-objects/username.vo';
import type { UserProfileSnapshot } from '../types/user.types';

export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');

export interface IUserRepository {
  /** Persist a new or updated aggregate. */
  save(user: UserAggregate): Promise<void>;

  /** Find by UUID — returns undefined if not found. */
  findById(id: string): Promise<UserAggregate | undefined>;

  /** Find by email — for login & registration uniqueness check. */
  findByEmail(email: Email): Promise<UserAggregate | undefined>;

  /** Find by username — for profile page & uniqueness check. */
  findByUsername(username: Username): Promise<UserAggregate | undefined>;

  /** Fast existence check — avoids hydrating the full aggregate. */
  existsByEmail(email: Email): Promise<boolean>;

  existsByUsername(username: Username): Promise<boolean>;

  /**
   * Batch fetch for gRPC GetUserBatch calls.
   * Returns only found users (silently omits missing IDs).
   */
  findByIds(ids: string[]): Promise<UserAggregate[]>;

  /**
   * Paginated user search for admin panel.
   * Returns lightweight snapshots (not full aggregates) for performance.
   */
  search(params: {
    query?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: UserProfileSnapshot[]; nextCursor?: string }>;

  /**
   * Soft delete — sets status=DELETED, does NOT remove the row.
   * Hard purge is a separate scheduled job (GDPR compliance window).
   */
  softDelete(id: string): Promise<void>;
}
