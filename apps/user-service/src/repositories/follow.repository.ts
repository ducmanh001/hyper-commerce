import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { UserFollow } from '../entities/user-follow.entity';

export interface FollowerUserData {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

@Injectable()
export class FollowRepository {
  constructor(
    @InjectRepository(UserFollow)
    private readonly repo: Repository<UserFollow>,
  ) {}

  async findRelationship(followerId: string, followeeId: string): Promise<UserFollow | null> {
    return this.repo.findOne({ where: { followerId, followeeId } });
  }

  async getFollowers(
    followeeId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ items: FollowerUserData[]; nextCursor: string | null; hasMore: boolean }> {
    const qb = this.repo
      .createQueryBuilder('f')
      .innerJoin('users', 'u', 'u.id = f.followerId')
      .select([
        'f.followerId AS id',
        'u.username AS username',
        'u.full_name AS displayName',
        'u.avatar_url AS avatarUrl',
        'f.created_at AS createdAt',
      ])
      .where('f.followeeId = :followeeId', { followeeId })
      .orderBy('f.created_at', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('f.created_at < :cursor', {
        cursor: new Date(Buffer.from(cursor, 'base64url').toString()),
      });
    }

    const rows = await qb.getRawMany<FollowerUserData & { createdAt: Date }>();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(({ id, username, displayName, avatarUrl }) => ({
      id,
      username,
      displayName,
      avatarUrl: avatarUrl ?? undefined,
    }));
    const last = rows[Math.min(rows.length, limit) - 1];

    return {
      items,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              (last as any).createdAt instanceof Date
                ? (last as any).createdAt.toISOString()
                : String((last as any).createdAt),
            ).toString('base64url')
          : null,
      hasMore,
    };
  }

  async getFollowing(
    followerId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ items: FollowerUserData[]; nextCursor: string | null; hasMore: boolean }> {
    const qb = this.repo
      .createQueryBuilder('f')
      .innerJoin('users', 'u', 'u.id = f.followeeId')
      .select([
        'f.followeeId AS id',
        'u.username AS username',
        'u.full_name AS displayName',
        'u.avatar_url AS avatarUrl',
        'f.created_at AS createdAt',
      ])
      .where('f.followerId = :followerId', { followerId })
      .orderBy('f.created_at', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('f.created_at < :cursor', {
        cursor: new Date(Buffer.from(cursor, 'base64url').toString()),
      });
    }

    const rows = await qb.getRawMany<FollowerUserData & { createdAt: Date }>();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(({ id, username, displayName, avatarUrl }) => ({
      id,
      username,
      displayName,
      avatarUrl: avatarUrl ?? undefined,
    }));
    const last = rows[Math.min(rows.length, limit) - 1];

    return {
      items,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              (last as any).createdAt instanceof Date
                ? (last as any).createdAt.toISOString()
                : String((last as any).createdAt),
            ).toString('base64url')
          : null,
      hasMore,
    };
  }

  /** Get follower IDs for fan-out — only those with notifications enabled */
  async getFollowerIds(followeeId: string): Promise<string[]> {
    const rows = await this.repo.find({
      where: { followeeId, notificationsEnabled: true },
      select: ['followerId'],
    });
    return rows.map((r) => r.followerId);
  }

  async getFollowingIds(
    followerId: string,
    limit?: number,
    cursor?: string,
  ): Promise<{ ids: string[]; nextCursor: string | null }> {
    const qb = this.repo
      .createQueryBuilder('f')
      .select(['f.followeeId AS id', 'f.created_at AS createdAt'])
      .where('f.followerId = :followerId', { followerId })
      .orderBy('f.created_at', 'DESC');

    if (limit) qb.limit(limit + 1);
    if (cursor) {
      qb.andWhere('f.created_at < :cursor', {
        cursor: new Date(Buffer.from(cursor, 'base64url').toString()),
      });
    }

    const rows = await qb.getRawMany<{ id: string; createdAt: Date }>();
    const hasMore = limit !== undefined && rows.length > limit;
    const sliced = limit !== undefined ? rows.slice(0, limit) : rows;
    const last = sliced[sliced.length - 1];

    return {
      ids: sliced.map((r) => r.id),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              (last.createdAt instanceof Date
                ? last.createdAt
                : new Date(last.createdAt)
              ).toISOString(),
            ).toString('base64url')
          : null,
    };
  }

  async createFollow(
    followerId: string,
    followeeId: string,
    manager?: EntityManager,
  ): Promise<UserFollow> {
    const repo = manager ? manager.getRepository(UserFollow) : this.repo;
    const entity = repo.create({ followerId, followeeId });
    return repo.save(entity);
  }

  async deleteFollow(
    followerId: string,
    followeeId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(UserFollow) : this.repo;
    await repo.delete({ followerId, followeeId });
  }

  async create(data: Partial<UserFollow>): Promise<UserFollow> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async delete(followerId: string, followeeId: string): Promise<void> {
    await this.repo.delete({ followerId, followeeId });
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const count = await this.repo.count({ where: { followerId, followeeId } });
    return count > 0;
  }

  /** Block check — returns false if no block table exists yet */
  async isBlocked(_followerId: string, _followeeId: string): Promise<boolean> {
    return false;
  }
}
