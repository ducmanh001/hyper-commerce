/**
 * UserMapper — Bidirectional mapping between UserAggregate and UserDocument
 *
 * WHY A DEDICATED MAPPER:
 *   Keeps the mapping logic in one place — easy to find, easy to test.
 *   If ORM schema changes (rename column), only the mapper changes.
 *   If domain adds a new field, you see immediately it's not persisted.
 *
 * ANTI-PATTERN: don't scatter `.toEntity()` methods on domain classes,
 *   because that forces domain to know about TypeORM.
 *
 * DIRECTION:
 *   toDomain()  — ORM document → pure domain aggregate (for business operations)
 *   toPersistence() — domain aggregate → ORM document (for saving)
 */
import type { UserAggregateProps } from '../../../domain/entities/user.aggregate';
import { UserAggregate } from '../../../domain/entities/user.aggregate';
import type { UserDocument } from '../documents/user.document';
import type { UserStatus, UserRole } from '../../../domain/types/user.types';

export class UserMapper {
  /**
   * Build a domain aggregate from a TypeORM document.
   * Called after DB reads — no domain events emitted.
   */
  static toDomain(doc: UserDocument): UserAggregate {
    const props: UserAggregateProps = {
      id: doc.id,
      email: doc.email,
      username: doc.username,
      passwordHash: doc.passwordHash,
      displayName: doc.displayName,
      avatarUrl: doc.avatarUrl,
      bio: doc.bio,
      status: doc.status as UserStatus,
      roles: doc.roles as UserRole[],
      emailVerified: doc.emailVerified,
      phoneVerified: doc.phoneVerified,
      phone: doc.phone,
      sellerId: doc.sellerId,
      followerCount: doc.followerCount,
      followingCount: doc.followingCount,
      preferences: doc.preferences,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
    return UserAggregate.reconstitute(props);
  }

  /**
   * Extract a plain object that TypeORM can UPSERT.
   * Does NOT create a UserDocument instance (avoids ORM overhead for simple upserts).
   */
  static toPersistence(user: UserAggregate): Partial<UserDocument> {
    return {
      id: user.id,
      email: user.email.value,
      username: user.username.value,
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      status: user.status,
      roles: user.roles,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      phone: user.phone,
      sellerId: user.sellerId,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      preferences: user.preferences,
      updatedAt: user.updatedAt,
    };
  }
}
