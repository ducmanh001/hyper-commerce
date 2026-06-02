/**
 * FollowUserHandler — Handle follow/unfollow commands
 *
 * COMPLEXITY: Following seems simple (insert a row), but has several concerns:
 *
 * 1. DENORMALIZED COUNTERS
 *    We keep followerCount/followingCount on the User aggregate for fast reads.
 *    Each follow = update follower's followingCount + followee's followerCount.
 *    This must be atomic — use DB transaction or optimistic locking.
 *
 * 2. CELEBRITY THRESHOLD CROSSING
 *    When a follow pushes followerCount over 50K, the fan-out strategy switches.
 *    We emit a special event so feed-service can handle the transition.
 *
 * 3. SELF-FOLLOW PREVENTION
 *    Checked at domain level (CannotFollowSelfException).
 *
 * 4. ALREADY-FOLLOWING IDEMPOTENCY
 *    If followerId already follows followeeId, we throw AlreadyFollowingException
 *    (the client should check isFollowing state before calling).
 */
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';
import { FollowUserCommand, UnfollowUserCommand } from './follow-user.command';
import {
  UserNotFoundException,
  CannotFollowSelfException,
  AlreadyFollowingException,
} from '../../../domain/exceptions/user.exceptions';
import {
  USER_REPOSITORY_PORT, IUserRepository,
} from '../../../domain/repositories/user.repository.port';
import {
  FOLLOW_REPOSITORY_PORT, IFollowRepository,
} from '../../../domain/repositories/follow.repository.port';
import {
  USER_EVENT_PUBLISHER_PORT, IUserEventPublisherPort,
} from '../../ports/application.ports';
import { UserFollowedEvent, UserUnfollowedEvent } from '../../../domain/events/user.events';

@CommandHandler(FollowUserCommand)
export class FollowUserHandler implements ICommandHandler<FollowUserCommand, void> {
  private readonly logger = new Logger(FollowUserHandler.name);

  constructor(
    @Inject(USER_REPOSITORY_PORT)   private readonly userRepo: IUserRepository,
    @Inject(FOLLOW_REPOSITORY_PORT) private readonly followRepo: IFollowRepository,
    @Inject(USER_EVENT_PUBLISHER_PORT) private readonly events: IUserEventPublisherPort,
  ) {}

  async execute(cmd: FollowUserCommand): Promise<void> {
    const { followerId, followeeId } = cmd;

    // ── Guard: cannot follow yourself ──────────────────────────────────────
    if (followerId === followeeId) {
      throw new CannotFollowSelfException(followerId);
    }

    // ── Load both users (parallel) ─────────────────────────────────────────
    const [follower, followee] = await Promise.all([
      this.userRepo.findById(followerId),
      this.userRepo.findById(followeeId),
    ]);

    if (!follower) throw new UserNotFoundException(followerId);
    if (!followee) throw new UserNotFoundException(followeeId);

    // ── Guard: not already following ───────────────────────────────────────
    const alreadyFollowing = await this.followRepo.isFollowing(followerId, followeeId);
    if (alreadyFollowing) throw new AlreadyFollowingException(followerId, followeeId);

    // ── Create follow record ───────────────────────────────────────────────
    await this.followRepo.follow(followerId, followeeId);

    // ── Update denormalized counters on both aggregates ────────────────────
    follower.incrementFollowingCount();
    const becameCelebrity = followee.incrementFollowerCount();

    await Promise.all([
      this.userRepo.save(follower),
      this.userRepo.save(followee),
    ]);

    // ── Publish follow event ───────────────────────────────────────────────
    await this.events.publish(
      new UserFollowedEvent(followerId, followeeId, followee.isCelebrity),
    );

    // ── Log celebrity threshold crossing ──────────────────────────────────
    if (becameCelebrity) {
      this.logger.log({
        event: 'celebrity_threshold_crossed',
        userId: followeeId,
        followerCount: followee.followerCount,
      });
    }
  }
}

@CommandHandler(UnfollowUserCommand)
export class UnfollowUserHandler implements ICommandHandler<UnfollowUserCommand, void> {
  constructor(
    @Inject(USER_REPOSITORY_PORT)   private readonly userRepo: IUserRepository,
    @Inject(FOLLOW_REPOSITORY_PORT) private readonly followRepo: IFollowRepository,
    @Inject(USER_EVENT_PUBLISHER_PORT) private readonly events: IUserEventPublisherPort,
  ) {}

  async execute(cmd: UnfollowUserCommand): Promise<void> {
    const { followerId, followeeId } = cmd;

    const [follower, followee] = await Promise.all([
      this.userRepo.findById(followerId),
      this.userRepo.findById(followeeId),
    ]);

    if (!follower) throw new UserNotFoundException(followerId);
    if (!followee) throw new UserNotFoundException(followeeId);

    await this.followRepo.unfollow(followerId, followeeId);

    follower.decrementFollowingCount();
    followee.decrementFollowerCount();

    await Promise.all([
      this.userRepo.save(follower),
      this.userRepo.save(followee),
    ]);

    await this.events.publish(new UserUnfollowedEvent(followerId, followeeId));
  }
}
