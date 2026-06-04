import type { ICommandHandler } from '@nestjs/cqrs';
import { CommandHandler } from '@nestjs/cqrs';
import { Inject, Logger, ForbiddenException } from '@nestjs/common';
import { UpdateProfileCommand } from './update-profile.command';
import { UserNotFoundException } from '../../../domain/exceptions/user.exceptions';
import type { IUserRepository } from '../../../domain/repositories/user.repository.port';
import { USER_REPOSITORY_PORT } from '../../../domain/repositories/user.repository.port';
import type { IUserCachePort, IUserEventPublisherPort } from '../../ports/application.ports';
import { USER_CACHE_PORT, USER_EVENT_PUBLISHER_PORT } from '../../ports/application.ports';

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand, void> {
  private readonly logger = new Logger(UpdateProfileHandler.name);

  constructor(
    @Inject(USER_REPOSITORY_PORT) private readonly userRepo: IUserRepository,
    @Inject(USER_CACHE_PORT) private readonly cache: IUserCachePort,
    @Inject(USER_EVENT_PUBLISHER_PORT) private readonly eventPublisher: IUserEventPublisherPort,
  ) {}

  async execute(cmd: UpdateProfileCommand): Promise<void> {
    // ── Authorization ──────────────────────────────────────────────────────
    // Users can only update their own profile.
    // Admins bypass this via a separate admin command.
    if (cmd.userId !== cmd.requesterId) {
      throw new ForbiddenException('You can only update your own profile');
    }

    // ── Load aggregate ─────────────────────────────────────────────────────
    const user = await this.userRepo.findById(cmd.userId);
    if (!user) throw new UserNotFoundException(cmd.userId);

    // ── Apply changes (domain validates invariants) ────────────────────────
    // UserAggregate.updateProfile() throws if user is suspended/deleted
    user.updateProfile(cmd.changes);

    // ── Persist ────────────────────────────────────────────────────────────
    await this.userRepo.save(user);

    // ── Invalidate cache ───────────────────────────────────────────────────
    // Profile changed → old cached snapshot is stale.
    await this.cache.invalidateProfile(cmd.userId);

    // ── Publish events ─────────────────────────────────────────────────────
    const events = user.collectDomainEvents();
    await this.eventPublisher.publishAll(events);

    this.logger.debug({ event: 'profile_updated', userId: cmd.userId });
  }
}
