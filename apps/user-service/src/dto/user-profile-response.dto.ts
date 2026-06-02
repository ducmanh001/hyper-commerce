import { User } from '../entities/user.entity';

export class UserProfileResponseDto {
  id!: string;
  email!: string;
  username!: string;
  displayName!: string;
  avatarUrl?: string;
  bio?: string;
  followerCount!: number;
  followingCount!: number;
  isCelebrity!: boolean;
  emailVerified!: boolean;
  createdAt!: Date;
  // Enriched by viewer context (not stored in DB)
  isFollowing?: boolean;
  isBlocked?: boolean;

  static fromEntity(user: User): UserProfileResponseDto {
    const dto = new UserProfileResponseDto();
    dto.id            = user.id;
    dto.email         = user.email;
    dto.username      = user.username;
    dto.displayName   = user.fullName ?? user.username;
    dto.avatarUrl     = user.avatarUrl;
    dto.bio           = user.bio;
    dto.followerCount = user.followerCount;
    dto.followingCount = user.followingCount;
    dto.isCelebrity   = user.followerCount >= 50_000;
    dto.emailVerified = user.emailVerified;
    dto.createdAt     = user.createdAt;
    return dto;
  }
}
