// apps/user-service/src/grpc/user.grpc.controller.ts
// Handles gRPC calls from other services (order, feed, notification, etc.)
// All inter-service user lookups MUST go through this — not HTTP.

import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from '@hypercommerce/grpc';

interface GetUserRequest {
  userId: string;
  fields?: string[];
}

interface GetUserBatchRequest {
  userIds: string[];
  fields?: string[];
}

interface GetUserProfileRequest {
  userId: string;
  viewerId?: string;
}

interface CheckUserExistsRequest {
  userId: string;
}

interface GetFollowerCountRequest {
  userId: string;
}

// Shape of data returned from user service
interface UserData {
  id: string;
  username?: string;
  email?: string;
  avatarUrl?: string;
  displayName?: string;
  isCelebrity?: boolean;
  followerCount?: number;
  createdAt?: Date | string;
}

@Controller()
@UseFilters(new GrpcExceptionFilter())
export class UserGrpcController {
  // In production: inject UserService and FollowService
  // constructor(
  //   private readonly userService: UserService,
  //   private readonly followService: FollowService,
  // ) {}

  @GrpcMethod('UserService', 'GetUser')
  async getUser(data: GetUserRequest) {
    // const user = await this.userService.findById(data.userId);
    // if (!user) throw new NotFoundException();
    // return this.toResponse(user, data.fields);
    return {
      id: data.userId,
      username: '',
      email: '',
      avatarUrl: '',
      displayName: '',
      isCelebrity: false,
      followerCount: 0,
      createdAt: Date.now(),
    };
  }

  @GrpcMethod('UserService', 'GetUserBatch')
  async getUserBatch(data: GetUserBatchRequest) {
    const users = await Promise.all(
      data.userIds.map((id) => this.getUser({ userId: id, fields: data.fields })),
    );
    return { users };
  }

  @GrpcMethod('UserService', 'GetUserProfile')
  async getUserProfile(data: GetUserProfileRequest) {
    const user = await this.getUser({ userId: data.userId });
    return {
      user,
      isFollowing: false,
      isBlocked: false,
      postCount: 0,
      followingCount: 0,
    };
  }

  @GrpcMethod('UserService', 'CheckUserExists')
  async checkUserExists(data: CheckUserExistsRequest) {
    // const exists = await this.userService.exists(data.userId);
    return { exists: true };
  }

  @GrpcMethod('UserService', 'GetFollowerCount')
  async getFollowerCount(data: GetFollowerCountRequest) {
    // const count = await this.followService.getFollowerCount(data.userId);
    return { count: 0 };
  }
}
