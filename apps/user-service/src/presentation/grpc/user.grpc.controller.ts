/**
 * UserGrpcController — gRPC server implementation for the UserService proto.
 *
 * WHY gRPC for internal service calls:
 *   - Protobuf = ~10x smaller payload than JSON
 *   - HTTP/2 multiplexing = one TCP connection handles many concurrent RPCs
 *   - Strong typing via .proto contracts = no schema drift between services
 *   - ~2ms p99 vs ~10ms p99 for REST+JSON on the same LAN
 *
 * USAGE:
 *   Order-service → "get user display name for order confirmation"
 *   Feed-service  → "get user celebrity status for fan-out decision"
 *   Both call this gRPC controller directly (not the REST API).
 *
 * PATTERN: thin controller, delegates to QueryBus (same CQRS handlers as REST)
 *   This means the business logic is DRY — one handler, two transports.
 */
import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type { QueryBus } from '@nestjs/cqrs';
import { GetUserProfileQuery } from '../../application/queries/user.queries';

// gRPC request/response interfaces — must match user.proto message definitions
interface GetUserRequest {
  user_id: string;
  fields?: string[];
}

interface GetUserBatchRequest {
  user_ids: string[];
  fields?: string[];
}

interface GetUserProfileRequest {
  user_id: string;
  viewer_id?: string;
}

interface CheckUserExistsRequest {
  user_id: string;
}

interface GetFollowerCountRequest {
  user_id: string;
}

interface UserResponse {
  id: string;
  username: string;
  email: string;
  avatar_url: string;
  display_name: string;
  is_celebrity: boolean;
  follower_count: number;
  created_at: number; // unix timestamp ms
}

@Controller()
export class UserGrpcController {
  private readonly logger = new Logger(UserGrpcController.name);

  constructor(private readonly queryBus: QueryBus) {}

  /**
   * GetUser — return basic user info by ID.
   * Called by order-service to show buyer/seller name.
   */
  @GrpcMethod('UserService', 'GetUser')
  async getUser(request: GetUserRequest): Promise<UserResponse> {
    this.logger.debug(`gRPC GetUser: ${request.user_id}`);

    const profile = await this.queryBus.execute(new GetUserProfileQuery(request.user_id));

    return this.toUserResponse(profile);
  }

  /**
   * GetUserBatch — bulk fetch up to 100 users in one RPC.
   * Used by feed-service when hydrating post author info for a feed page.
   * Much cheaper than N individual GetUser calls.
   */
  @GrpcMethod('UserService', 'GetUserBatch')
  async getUserBatch(request: GetUserBatchRequest): Promise<{ users: UserResponse[] }> {
    this.logger.debug(`gRPC GetUserBatch: ${request.user_ids.length} users`);

    const profiles = await Promise.all(
      request.user_ids.map((id) =>
        this.queryBus.execute(new GetUserProfileQuery(id)).catch(() => null),
      ),
    );

    return {
      users: profiles.filter(Boolean).map((p) => this.toUserResponse(p)),
    };
  }

  /**
   * GetUserProfile — full profile including viewer-specific fields.
   * Called by follow-service to show profile page.
   */
  @GrpcMethod('UserService', 'GetUserProfile')
  async getUserProfile(request: GetUserProfileRequest) {
    const profile = await this.queryBus.execute(
      new GetUserProfileQuery(request.user_id, request.viewer_id),
    );

    return {
      user: this.toUserResponse(profile),
      is_following: profile.isFollowing ?? false,
      is_blocked: profile.isBlocked ?? false,
      post_count: 0, // owned by post-service — fetch separately
      following_count: profile.followingCount ?? 0,
    };
  }

  /**
   * CheckUserExists — lightweight existence check.
   * Called by payment-service before processing a payout.
   */
  @GrpcMethod('UserService', 'CheckUserExists')
  async checkUserExists(request: CheckUserExistsRequest): Promise<{ exists: boolean }> {
    try {
      await this.queryBus.execute(new GetUserProfileQuery(request.user_id));
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }

  /**
   * GetFollowerCount — used by feed-service to decide fan-out strategy.
   * Celebrity check: followerCount >= 50K → pull-based fan-out.
   */
  @GrpcMethod('UserService', 'GetFollowerCount')
  async getFollowerCount(request: GetFollowerCountRequest): Promise<{ count: number }> {
    const profile = await this.queryBus.execute(new GetUserProfileQuery(request.user_id));
    return { count: profile?.followerCount ?? 0 };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private toUserResponse(profile: Record<string, unknown>): UserResponse {
    return {
      id: String(profile['id'] ?? ''),
      username: String(profile['username'] ?? ''),
      email: String(profile['email'] ?? ''),
      avatar_url: String(profile['avatarUrl'] ?? ''),
      display_name: String(profile['displayName'] ?? ''),
      is_celebrity: Boolean(profile['isCelebrity']),
      follower_count: Number(profile['followerCount'] ?? 0),
      created_at:
        profile['createdAt'] instanceof Date
          ? profile['createdAt'].getTime()
          : Number(profile['createdAt'] ?? 0),
    };
  }
}
