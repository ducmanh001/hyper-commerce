// ============================================================
// HYPERCOMMERCE — User Service
// Owns: user profile, follow graph, celebrity detection,
// hybrid push-pull fan-out decision, social stats.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { FollowService } from './follow/follow.service';
import { RedisClientService } from '@hypercommerce/redis';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import {
  CreateUserDto,
  UpdateUserDto,
  UserProfileResponseDto,
  FollowResponseDto,
} from './dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly followService: FollowService,
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Profile ───────────────────────────────────────────────

  async createUser(dto: CreateUserDto): Promise<UserProfileResponseDto> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(`Email '${dto.email}' already registered`);
    }

    const user = await this.userRepo.create({
      email: dto.email,
      username: dto.username,
      displayName: dto.displayName,
      passwordHash: dto.passwordHash,
    });

    // Warm cache immediately after creation
    await this.cacheUserProfile(user);

    this.logger.log(
      JSON.stringify({ event: 'user_created', userId: user.id }),
    );

    return UserProfileResponseDto.fromEntity(user);
  }

  async getUserProfile(
    userId: string,
    viewerId?: string,
  ): Promise<UserProfileResponseDto> {
    // 1. Try Redis cache (L1) — ~0.5ms
    const cached = await this.getCachedProfile(userId);
    if (cached) {
      return this.enrichWithViewerContext(cached, viewerId);
    }

    // 2. DB fetch (L2) — ~5ms on local shard
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException('User', userId);

    // 3. Write-back to cache
    await this.cacheUserProfile(user);

    return this.enrichWithViewerContext(
      UserProfileResponseDto.fromEntity(user),
      viewerId,
    );
  }

  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    requesterId: string,
  ): Promise<UserProfileResponseDto> {
    if (userId !== requesterId) {
      throw new ForbiddenException('user', 'update');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException('User', userId);

    // Apply partial updates to the entity and save
    Object.assign(user, {
      ...(dto.displayName !== undefined && { fullName: dto.displayName }),
      ...(dto.bio         !== undefined && { bio: dto.bio }),
      ...(dto.avatarUrl   !== undefined && { avatarUrl: dto.avatarUrl }),
    });
    const updated = await this.userRepo.save(user);

    // Invalidate cache
    await this.redis.del(`${APP_CONSTANTS.REDIS_KEYS.USER_PROFILE}${userId}`);

    this.events.emit('user.updated', { userId, changes: dto });

    return UserProfileResponseDto.fromEntity(updated);
  }

  // ── Social Stats ──────────────────────────────────────────

  async getSocialStats(userId: string): Promise<{
    followersCount: number;
    followingCount: number;
    postsCount: number;
    isCelebrity: boolean;
  }> {
    const cacheKey = `social:stats:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ReturnType<typeof this.getSocialStats> extends Promise<infer R> ? R : never;

    const [followersCount, followingCount] = await Promise.all([
      this.followService.countFollowers(userId),
      this.followService.countFollowing(userId),
    ]);
    const postsCount = 0; // posts not owned by user-service — fetch from post-service

    const isCelebrity =
      followersCount >= APP_CONSTANTS.CELEBRITY_FOLLOWER_THRESHOLD;

    const stats = { followersCount, followingCount, postsCount, isCelebrity };

    // Cache for 5 minutes — stats lag is acceptable
    await this.redis.set(cacheKey, JSON.stringify(stats), 300);

    return stats;
  }

  // ── Cache Helpers ─────────────────────────────────────────

  private async cacheUserProfile(user: User): Promise<void> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.USER_PROFILE}${user.id}`;
    const dto = UserProfileResponseDto.fromEntity(user);
    // TTL 5min — balance freshness vs DB load
    await this.redis.set(key, JSON.stringify(dto), 300);
  }

  private async getCachedProfile(userId: string): Promise<UserProfileResponseDto | null> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.USER_PROFILE}${userId}`;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as UserProfileResponseDto) : null;
  }

  private enrichWithViewerContext(
    profile: UserProfileResponseDto,
    viewerId?: string,
  ): UserProfileResponseDto {
    // Viewer-specific data (isFollowing, isBlocked) added here
    // without modifying the cached profile
    if (!viewerId || viewerId === profile.id) return profile;
    // NOTE: isFollowing check resolved lazily by client or via separate endpoint
    // to avoid N+1 on list views
    return profile;
  }

  // ── Legacy controller-compatible methods ──────────────────

  async findByIdOrFail(userId: string): Promise<UserProfileResponseDto> {
    return this.getUserProfile(userId);
  }

  async updateProfile(userId: string, body: Record<string, unknown>): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException('User', userId);

    Object.assign(user, {
      ...(body['displayName'] !== undefined && { displayName: body['displayName'] as string }),
      ...(body['bio']         !== undefined && { bio: body['bio'] as string }),
      ...(body['avatarUrl']   !== undefined && { avatarUrl: body['avatarUrl'] as string }),
      ...(body['fullName']    !== undefined && { fullName: body['fullName'] as string }),
    });
    const updated = await this.userRepo.save(user);
    await this.redis.del(`${APP_CONSTANTS.REDIS_KEYS.USER_PROFILE}${userId}`);
    return UserProfileResponseDto.fromEntity(updated);
  }

  async search(query: string): Promise<UserProfileResponseDto[]> {
    const users = await this.userRepo.search(query);
    return users.map((u) => UserProfileResponseDto.fromEntity(u));
  }

  async findByUsername(username: string): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findByUsername(username);
    if (!user) throw new NotFoundException('User', username);
    return UserProfileResponseDto.fromEntity(user);
  }
}
