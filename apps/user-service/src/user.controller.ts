import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, ParseUUIDPipe,
  HttpCode, HttpStatus, UseGuards, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard, CurrentUser, JwtPayload, Public } from '@hypercommerce/common';
import { UserService } from './user.service';
import { FollowService } from './follow/follow.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly followService: FollowService,
  ) {}

  // ── Profile ───────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getMyProfile(@CurrentUser() user: JwtPayload) {
    return this.userService.findByIdOrFail(user.sub);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.userService.updateProfile(user.sub, body);
  }

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Search users by username or name' })
  @ApiQuery({ name: 'q', required: true })
  async searchUsers(@Query('q') query: string) {
    return this.userService.search(query);
  }

  @Get(':username')
  @Public()
  @ApiOperation({ summary: 'Get public profile by username' })
  async getPublicProfile(@Param('username') username: string) {
    return this.userService.findByUsername(username);
  }

  // ── Follow / Unfollow ─────────────────────────────────────

  @Post(':userId/follow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow a user' })
  async follow(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.followService.follow(user.sub, targetUserId);
  }

  @Delete(':userId/follow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unfollow a user' })
  async unfollow(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.followService.unfollow(user.sub, targetUserId);
  }

  @Get(':userId/followers')
  @Public()
  @ApiOperation({ summary: 'Get followers list' })
  async getFollowers(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = 50,
  ) {
    return this.followService.getFollowers(userId, cursor, Number(limit));
  }

  @Get(':userId/following')
  @Public()
  @ApiOperation({ summary: 'Get following list' })
  async getFollowing(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit') limit = 50,
  ) {
    return this.followService.getFollowing(userId, undefined, Number(limit));
  }
}
