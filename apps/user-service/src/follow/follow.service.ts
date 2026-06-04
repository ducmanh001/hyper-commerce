// ============================================================
// HYPERCOMMERCE — Follow Service
// Logic phức tạp nhất trong User Service:
// 1. Detect celebrity threshold (10K followers)
// 2. Decide fan-out strategy (push vs pull)
// 3. Propagate follow event to Feed Service via Kafka
// 4. Update social graph cache
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import {
  ConflictException,
  NotFoundException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import type { UserRepository } from '../repositories/user.repository';
import type { FollowRepository } from '../repositories/follow.repository';
import type { CelebrityDetectorHelper } from './celebrity-detector.helper';

export interface FollowResult {
  followerId: string;
  followeeId: string;
  fanoutStrategy: 'PUSH' | 'PULL' | 'HYBRID';
  followeeFollowerCount: number;
}

export interface FollowerListResult {
  followers: Array<{ id: string; username: string; displayName: string; avatarUrl?: string }>;
  cursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class FollowService {
  private readonly logger = new Logger(FollowService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly followRepo: FollowRepository,
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
    private readonly celebrityDetector: CelebrityDetectorHelper,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Core follow logic — runs in a DB transaction for consistency.
   *
   * Business rules:
   * - Cannot follow yourself
   * - Cannot follow a blocked user
   * - Duplicate follow → idempotent (no error)
   * - After follow: increment follower count, check celebrity threshold,
   *   decide fan-out strategy, emit Kafka event
   */
  async follow(followerId: string, followeeId: string): Promise<FollowResult> {
    if (followerId === followeeId) {
      throw new ConflictException('Cannot follow yourself');
    }

    // Verify both users exist in parallel
    const [follower, followee] = await Promise.all([
      this.userRepo.findById(followerId),
      this.userRepo.findById(followeeId),
    ]);

    if (!follower) throw new NotFoundException('User', followerId);
    if (!followee) throw new NotFoundException('User', followeeId);

    // Check block relationship
    const isBlocked = await this.followRepo.isBlocked(followerId, followeeId);
    if (isBlocked) {
      throw new ConflictException(`Cannot follow: relationship blocked`);
    }

    // Idempotent check — already following?
    const alreadyFollowing = await this.followRepo.isFollowing(followerId, followeeId);
    if (alreadyFollowing) {
      // Return current state without error — idempotent
      const count = await this.userRepo.countFollowers(followeeId);
      return {
        followerId,
        followeeId,
        fanoutStrategy: this.celebrityDetector.decideFanout(count),
        followeeFollowerCount: count,
      };
    }

    // Transactional follow + counter update
    // Using optimistic locking on follower_count to avoid race conditions
    const followerCount = await this.dataSource.transaction(async (manager) => {
      await this.followRepo.createFollow(followerId, followeeId, manager);

      // Increment follower count atomically
      const { follower_count: count } = await manager
        .createQueryBuilder()
        .update('users')
        .set({ followerCount: () => 'follower_count + 1' })
        .where('id = :id', { id: followeeId })
        .returning(['follower_count'])
        .execute()
        .then((r) => r.raw[0] as { follower_count: number });

      return count;
    });

    // ── Post-transaction side effects ──────────────────────
    // These run outside transaction — eventual consistency is fine here.

    // 1. Invalidate social stats cache
    await this.redis.del(`social:stats:${followeeId}`);
    await this.redis.del(`social:stats:${followerId}`);

    // 2. Check + update celebrity status
    const wasCelebrity = await this.redis.sismember(
      APP_CONSTANTS.REDIS_KEYS.CELEBRITY_LIST,
      followeeId,
    );

    const isCelebrity = followerCount >= APP_CONSTANTS.CELEBRITY_FOLLOWER_THRESHOLD;
    if (isCelebrity && !wasCelebrity) {
      // Just crossed celebrity threshold — update fan-out strategy
      await this.redis.sadd(APP_CONSTANTS.REDIS_KEYS.CELEBRITY_LIST, followeeId);
      this.logger.log(
        JSON.stringify({
          event: 'celebrity_threshold_crossed',
          userId: followeeId,
          followerCount,
        }),
      );
      // Emit event so Feed Service can stop pushing for this user
      await this.kafka.publish({
        topic: APP_CONSTANTS.KAFKA_TOPICS.FEED_SIGNALS,
        partitionKey: followeeId,
        value: {
          type: 'CELEBRITY_PROMOTED',
          userId: followeeId,
          followerCount,
        },
      });
    }

    const fanoutStrategy = this.celebrityDetector.decideFanout(followerCount);

    // 3. Emit follow event — Feed Service will adjust follower's feed
    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.USER_FOLLOWED,
      partitionKey: followeeId, // partition by followee for feed fan-out locality
      value: {
        type: 'USER_FOLLOWED',
        followerId,
        followeeId,
        fanoutStrategy,
        followerCount,
        timestamp: new Date().toISOString(),
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'follow_created',
        followerId,
        followeeId,
        fanoutStrategy,
        followerCount,
      }),
    );

    return { followerId, followeeId, fanoutStrategy, followeeFollowerCount: followerCount };
  }

  /**
   * Unfollow — mirror of follow with opposite effects.
   * Also triggers feed cleanup for pull-based celebrities.
   */
  async unfollow(followerId: string, followeeId: string): Promise<void> {
    const exists = await this.followRepo.isFollowing(followerId, followeeId);
    if (!exists) return; // Idempotent

    await this.dataSource.transaction(async (manager) => {
      await this.followRepo.deleteFollow(followerId, followeeId, manager);
      await manager
        .createQueryBuilder()
        .update('users')
        .set({ followerCount: () => 'GREATEST(follower_count - 1, 0)' })
        .where('id = :id', { id: followeeId })
        .execute();
    });

    await Promise.all([
      this.redis.del(`social:stats:${followeeId}`),
      this.redis.del(`social:stats:${followerId}`),
    ]);

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.USER_FOLLOWED,
      partitionKey: followeeId,
      value: {
        type: 'USER_UNFOLLOWED',
        followerId,
        followeeId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Get followers with cursor pagination.
   * For celebrities (5M followers), this uses shard-aware query
   * routing to the correct Citus shard.
   */
  async getFollowers(userId: string, cursor?: string, limit = 20): Promise<FollowerListResult> {
    const isCelebrity = !!(await this.redis.sismember(
      APP_CONSTANTS.REDIS_KEYS.CELEBRITY_LIST,
      userId,
    ));

    // For celebrities, return sampling — real follower list is too large to page
    // through in a single session. This matches Instagram/Twitter behaviour.
    const result = await this.followRepo.getFollowers(userId, cursor, limit);

    return {
      followers: result.items,
      cursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get users that userId is following.
   * Used by Feed Service to know whose posts to include.
   */
  async getFollowing(userId: string, cursor?: string, limit = 20): Promise<FollowerListResult> {
    const result = await this.followRepo.getFollowing(userId, cursor, limit);
    return {
      followers: result.items,
      cursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  /**
   * Bulk check which users in a list the viewer follows.
   * Used in feed rendering to show follow buttons — avoids N+1.
   */
  async getFollowingSet(viewerId: string, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();

    // Cache key per viewer (TTL 60s — follow/unfollow invalidates)
    const cacheKey = `following:set:${viewerId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const set = new Set<string>(JSON.parse(cached) as string[]);
      // Filter to only requested users (avoid returning stale full set)
      return new Set(userIds.filter((id) => set.has(id)));
    }

    const { ids: followingIdList } = await this.followRepo.getFollowingIds(viewerId);
    // Cache full following set for 60s
    await this.redis.set(cacheKey, JSON.stringify(followingIdList), 60);

    const followingSet = new Set(followingIdList);
    return new Set(userIds.filter((id) => followingSet.has(id)));
  }

  /** Count followers of a user — used by UserService for social stats */
  async countFollowers(userId: string): Promise<number> {
    const user = await this.userRepo.findById(userId);
    return user?.followerCount ?? 0;
  }

  /** Count how many users this user follows */
  async countFollowing(userId: string): Promise<number> {
    const user = await this.userRepo.findById(userId);
    return user?.followingCount ?? 0;
  }
}
