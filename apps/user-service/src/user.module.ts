/**
 * UserModule — Wires the entire user domain following Clean Architecture.
 *
 * LAYERS:
 *   Domain     → pure TypeScript, no framework
 *   Application → CQRS command/query handlers, port interfaces
 *   Infrastructure → TypeORM, Redis, Kafka, bcrypt, BloomFilter
 *   Presentation   → HTTP controllers, gRPC controllers
 *
 * DEPENDENCY INJECTION TOKENS:
 *   Domain ports use Symbol tokens because TS interfaces are erased at runtime.
 *   { provide: USER_REPOSITORY_PORT, useClass: TypeOrmUserRepository }
 *   To swap for tests: { provide: USER_REPOSITORY_PORT, useClass: InMemoryUserRepository }
 */
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

// Legacy entities (kept for backward compatibility during migration)
import { User } from './entities/user.entity';
import { UserFollow } from './entities/user-follow.entity';
import { UserProfile } from './entities/user-profile.entity';

// Config
import algorithmConfig from '@hypercommerce/common/config/algorithm.config';

// Domain tokens
import { USER_REPOSITORY_PORT } from './domain/repositories/user.repository.port';
import { FOLLOW_REPOSITORY_PORT } from './domain/repositories/follow.repository.port';
import {
  USER_CACHE_PORT,
  USER_EVENT_PUBLISHER_PORT,
  PASSWORD_HASHER_PORT,
} from './application/ports/application.ports';

// Command handlers
import { RegisterUserHandler } from './application/commands/register-user/register-user.handler';
import { UpdateProfileHandler } from './application/commands/update-profile/update-profile.handler';
import {
  FollowUserHandler,
  UnfollowUserHandler,
} from './application/commands/follow-user/follow-user.handler';

// Query handlers
import {
  GetUserProfileHandler,
  GetFollowersHandler,
  GetFollowingHandler,
  SearchUsersHandler,
  CheckUsernameAvailabilityHandler,
} from './application/queries/user-query.handlers';

// Infrastructure: persistence (new Clean Architecture layer)
import { UserDocument } from './infrastructure/persistence/documents/user.document';
import { TypeOrmUserRepository } from './infrastructure/persistence/repositories/typeorm-user.repository';

// Infrastructure: cache, messaging, security, bloom
import { UserCacheAdapter } from './infrastructure/cache/user.cache.adapter';
import { UserEventPublisher } from './infrastructure/messaging/user-event.publisher';
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password.hasher';
import { UserFeedDedupService } from './infrastructure/bloom/user-feed-dedup.service';

// Presentation (new Clean Architecture layer)
import { UserController } from './presentation/http/user.controller';
import { UserGrpcController } from './presentation/grpc/user.grpc.controller';

// Legacy services (kept for backward compat — to be removed after full migration)
import { UserService } from './user.service';
import { FollowService } from './follow/follow.service';
import { UserRepository } from './repositories/user.repository';
import { FollowRepository } from './repositories/follow.repository';
import { CelebrityDetectorHelper } from './follow/celebrity-detector.helper';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';

const COMMAND_HANDLERS = [
  RegisterUserHandler,
  UpdateProfileHandler,
  FollowUserHandler,
  UnfollowUserHandler,
];
const QUERY_HANDLERS = [
  GetUserProfileHandler,
  GetFollowersHandler,
  GetFollowingHandler,
  SearchUsersHandler,
  CheckUsernameAvailabilityHandler,
];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([User, UserFollow, UserProfile, UserDocument]),
    ConfigModule.forFeature(algorithmConfig),
  ],
  controllers: [UserController, UserGrpcController],
  providers: [
    // ── Port → Adapter bindings (Dependency Inversion) ─────────────────────
    { provide: USER_REPOSITORY_PORT, useClass: TypeOrmUserRepository },
    { provide: USER_CACHE_PORT, useClass: UserCacheAdapter },
    { provide: USER_EVENT_PUBLISHER_PORT, useClass: UserEventPublisher },
    { provide: PASSWORD_HASHER_PORT, useClass: BcryptPasswordHasher },
    { provide: FOLLOW_REPOSITORY_PORT, useClass: FollowRepository },

    // ── CQRS Handlers ───────────────────────────────────────────────────────
    ...COMMAND_HANDLERS,
    ...QUERY_HANDLERS,

    // ── Infrastructure Services ─────────────────────────────────────────────
    UserFeedDedupService, // BloomFilter feed dedup

    // ── Legacy services (in-migration, still needed by old UserController) ──
    UserService,
    FollowService,
    UserRepository,
    FollowRepository,
    CelebrityDetectorHelper,
    KafkaProducerService,
    RedisClientService,
  ],
  exports: [
    UserService,
    UserRepository,
    UserFeedDedupService, // Feed-service can import UserModule to use BloomFilter
  ],
})
export class UserModule {}
