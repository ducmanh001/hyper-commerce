/**
 * TypeORM User Repository — Implements the domain IUserRepository port
 *
 * This is an infrastructure concern: TypeORM, SQL, connection pooling.
 * The domain never sees this class — it only knows the IUserRepository interface.
 *
 * UPSERT STRATEGY:
 *   We use INSERT ... ON CONFLICT DO UPDATE (PostgreSQL UPSERT) instead of
 *   SELECT then INSERT/UPDATE. This is:
 *   - Race-condition safe (atomic)
 *   - Faster (one round-trip vs two)
 *   - Idempotent (safe to retry)
 *
 * PAGINATION via CURSOR (not OFFSET):
 *   OFFSET pagination: SELECT ... LIMIT 20 OFFSET 40
 *   Problem: if page 2 loads and someone inserts on page 1, page 2 misses an item.
 *
 *   CURSOR pagination: SELECT ... WHERE id > :cursor LIMIT 20
 *   The cursor is opaque (base64-encoded ID). Stable across insertions.
 *   Used everywhere here.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, DataSource } from 'typeorm';
import { UserDocument } from '../documents/user.document';
import { UserMapper } from '../mappers/user.mapper';
import type { IUserRepository } from '../../../domain/repositories/user.repository.port';
import type { UserAggregate } from '../../../domain/entities/user.aggregate';
import type { Email } from '../../../domain/value-objects/email.vo';
import type { Username } from '../../../domain/value-objects/username.vo';
import type { UserProfileSnapshot } from '../../../domain/types/user.types';
import { UserStatus } from '../../../domain/types/user.types';

@Injectable()
export class TypeOrmUserRepository implements IUserRepository {
  constructor(
    @InjectRepository(UserDocument)
    private readonly orm: Repository<UserDocument>,
    private readonly dataSource: DataSource,
  ) {}

  async save(user: UserAggregate): Promise<void> {
    const data = UserMapper.toPersistence(user);
    await this.orm
      .createQueryBuilder()
      .insert()
      .into(UserDocument)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(data as any)
      .orUpdate(
        // Columns to update on conflict
        [
          'passwordHash',
          'displayName',
          'avatarUrl',
          'bio',
          'status',
          'roles',
          'emailVerified',
          'phoneVerified',
          'phone',
          'sellerId',
          'followerCount',
          'followingCount',
          'preferences',
          'updatedAt',
        ],
        ['id'], // Conflict on primary key
      )
      .execute();
  }

  async findById(id: string): Promise<UserAggregate | undefined> {
    const doc = await this.orm.findOne({ where: { id } });
    return doc ? UserMapper.toDomain(doc) : undefined;
  }

  async findByEmail(email: Email): Promise<UserAggregate | undefined> {
    const doc = await this.orm.findOne({ where: { email: email.value } });
    return doc ? UserMapper.toDomain(doc) : undefined;
  }

  async findByUsername(username: Username): Promise<UserAggregate | undefined> {
    const doc = await this.orm.findOne({ where: { username: username.value } });
    return doc ? UserMapper.toDomain(doc) : undefined;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    return this.orm.exists({ where: { email: email.value } });
  }

  async existsByUsername(username: Username): Promise<boolean> {
    return this.orm.exists({ where: { username: username.value } });
  }

  async findByIds(ids: string[]): Promise<UserAggregate[]> {
    if (!ids.length) return [];
    const docs = await this.orm.createQueryBuilder('u').whereInIds(ids).getMany();
    return docs.map(UserMapper.toDomain);
  }

  async search(params: {
    query?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: UserProfileSnapshot[]; nextCursor?: string }> {
    const qb = this.orm
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.username',
        'u.displayName',
        'u.avatarUrl',
        'u.followerCount',
        'u.createdAt',
      ])
      .where('u.status = :status', { status: UserStatus.ACTIVE })
      .orderBy('u.id', 'ASC')
      .limit(params.limit + 1); // Fetch one extra to determine if there's a next page

    if (params.query) {
      qb.andWhere('(u.username ILIKE :q OR u.displayName ILIKE :q)', { q: `%${params.query}%` });
    }

    if (params.cursor) {
      const decodedCursor = Buffer.from(params.cursor, 'base64').toString('utf8');
      qb.andWhere('u.id > :cursor', { cursor: decodedCursor });
    }

    const docs = await qb.getMany();
    const hasMore = docs.length > params.limit;
    const items = hasMore ? docs.slice(0, params.limit) : docs;

    const nextCursor = hasMore
      ? Buffer.from(items[items.length - 1].id).toString('base64')
      : undefined;

    return {
      items: items.map((doc) => UserMapper.toDomain(doc).toSnapshot()),
      nextCursor,
    };
  }

  async softDelete(id: string): Promise<void> {
    await this.orm.update(id, { status: UserStatus.DELETED });
  }
}
