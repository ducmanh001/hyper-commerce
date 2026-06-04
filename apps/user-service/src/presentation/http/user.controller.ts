/**
 * UserController — HTTP presentation layer
 *
 * This controller is a THIN adapter between HTTP and the application layer.
 * It:
 *   1. Receives HTTP requests
 *   2. Validates input (class-validator via StrictValidationPipe)
 *   3. Dispatches to CQRS command bus or query bus
 *   4. Returns HTTP responses
 *
 * NO BUSINESS LOGIC HERE:
 *   Business logic lives in command/query handlers.
 *   Controllers only deal with HTTP concerns:
 *   - Request parsing
 *   - Authentication (guards)
 *   - Rate limiting
 *   - Response shaping
 *
 * HTTP STATUS MAPPING:
 *   Domain exceptions are caught by GlobalExceptionFilter and mapped to HTTP codes.
 *   EmailAlreadyTakenException → 409 Conflict
 *   UserNotFoundException      → 404 Not Found
 *   UserSuspendedException     → 403 Forbidden
 *   InvalidCredentialsException→ 401 Unauthorized
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
  Version,
} from '@nestjs/common';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';

import { RegisterUserCommand } from '../../application/commands/register-user/register-user.command';
import { UpdateProfileCommand } from '../../application/commands/update-profile/update-profile.command';
import {
  FollowUserCommand,
  UnfollowUserCommand,
} from '../../application/commands/follow-user/follow-user.command';
import {
  GetUserProfileQuery,
  GetFollowersQuery,
  GetFollowingQuery,
  SearchUsersQuery,
  CheckUsernameAvailabilityQuery,
} from '../../application/queries/user.queries';

import { JwtAuthGuard } from '@hypercommerce/common/guards/jwt-auth.guard';
import { Public } from '@hypercommerce/common/decorators/public.decorator';
import { CurrentUser } from '@hypercommerce/common/decorators/current-user.decorator';
import {
  TokenBucketRateLimitGuard,
  RateLimit,
} from '@hypercommerce/common/guards/token-bucket-rate-limit.guard';

// ── Request DTOs ──────────────────────────────────────────────────────────────

import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class RegisterUserDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'alice_dev' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Alice Smith' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;
}

class UpdateProfileDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TokenBucketRateLimitGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  // ── Registration ──────────────────────────────────────────────────────────

  @Public() // No JWT required
  @RateLimit({ rpm: 5, burstSize: 3 }) // Strict: max 5 registrations/min per IP
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  register(@Body() dto: RegisterUserDto) {
    return this.commandBus.execute(
      new RegisterUserCommand(dto.email, dto.username, dto.password, dto.displayName),
    );
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  getMyProfile(@CurrentUser('sub') userId: string) {
    return this.queryBus.execute(new GetUserProfileQuery(userId, userId));
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile' })
  updateMyProfile(@CurrentUser('sub') userId: string, @Body() dto: UpdateProfileDto) {
    return this.commandBus.execute(new UpdateProfileCommand(userId, userId, dto));
  }

  @Public()
  @Get(':userId')
  @ApiOperation({ summary: 'Get user profile by ID' })
  @ApiParam({ name: 'userId', type: String })
  getUserProfile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('sub') viewerId: string,
  ) {
    return this.queryBus.execute(new GetUserProfileQuery(userId, viewerId));
  }

  // ── Search ────────────────────────────────────────────────────────────────

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search users by username or display name' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false })
  searchUsers(
    @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.queryBus.execute(new SearchUsersQuery(query, limit, cursor));
  }

  @Public()
  @Get('username/check')
  @ApiOperation({ summary: 'Check if a username is available' })
  checkUsername(@Query('username') username: string) {
    return this.queryBus.execute(new CheckUsernameAvailabilityQuery(username));
  }

  // ── Follow Graph ──────────────────────────────────────────────────────────

  @Post(':userId/follow')
  @RateLimit({ rpm: 30 }) // 30 follows/min — prevents follow spam
  @ApiOperation({ summary: 'Follow a user' })
  follow(
    @CurrentUser('sub') followerId: string,
    @Param('userId', ParseUUIDPipe) followeeId: string,
  ) {
    return this.commandBus.execute(new FollowUserCommand(followerId, followeeId));
  }

  @Delete(':userId/follow')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unfollow a user' })
  unfollow(
    @CurrentUser('sub') followerId: string,
    @Param('userId', ParseUUIDPipe) followeeId: string,
  ) {
    return this.commandBus.execute(new UnfollowUserCommand(followerId, followeeId));
  }

  @Get(':userId/followers')
  @ApiOperation({ summary: 'Get followers list' })
  getFollowers(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.queryBus.execute(new GetFollowersQuery(userId, limit, cursor));
  }

  @Get(':userId/following')
  @ApiOperation({ summary: 'Get following list' })
  getFollowing(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.queryBus.execute(new GetFollowingQuery(userId, limit, cursor));
  }
}
