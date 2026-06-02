import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';
import { RegisterUserCommand } from './register-user.command';
import { UserAggregate } from '../../../domain/entities/user.aggregate';
import { Email } from '../../../domain/value-objects/email.vo';
import { Username } from '../../../domain/value-objects/username.vo';
import {
  EmailAlreadyTakenException,
  UsernameAlreadyTakenException,
} from '../../../domain/exceptions/user.exceptions';
import {
  USER_REPOSITORY_PORT, IUserRepository,
} from '../../../domain/repositories/user.repository.port';
import {
  PASSWORD_HASHER_PORT, IPasswordHasherPort,
  USER_EVENT_PUBLISHER_PORT, IUserEventPublisherPort,
} from '../../ports/application.ports';

export interface RegisterUserResult {
  userId:   string;
  username: string;
  email:    string;
}

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand, RegisterUserResult> {
  private readonly logger = new Logger(RegisterUserHandler.name);

  constructor(
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepo: IUserRepository,

    @Inject(PASSWORD_HASHER_PORT)
    private readonly passwordHasher: IPasswordHasherPort,

    @Inject(USER_EVENT_PUBLISHER_PORT)
    private readonly eventPublisher: IUserEventPublisherPort,
  ) {}

  async execute(cmd: RegisterUserCommand): Promise<RegisterUserResult> {
    // ── Step 1: Create & validate value objects ────────────────────────────
    // Email/Username constructors throw if format is invalid.
    // We let these bubble as 400 Bad Request at the controller level.
    const email    = new Email(cmd.email);
    const username = new Username(cmd.username);

    // ── Step 2: Uniqueness checks (parallel for speed) ─────────────────────
    const [emailTaken, usernameTaken] = await Promise.all([
      this.userRepo.existsByEmail(email),
      this.userRepo.existsByUsername(username),
    ]);

    if (emailTaken)    throw new EmailAlreadyTakenException(email.value);
    if (usernameTaken) throw new UsernameAlreadyTakenException(username.value);

    // ── Step 3: Hash password ──────────────────────────────────────────────
    // bcrypt hashing is intentionally slow (cost factor 12).
    // This is the correct layer: not domain (too pure), not infrastructure (too low).
    const passwordHash = await this.passwordHasher.hash(cmd.password);

    // ── Step 4: Create domain aggregate ───────────────────────────────────
    // This emits UserRegisteredEvent internally.
    const user = UserAggregate.register({
      email:        email.value,
      username:     username.value,
      passwordHash,
      displayName:  cmd.displayName,
    });

    // ── Step 5: Persist ───────────────────────────────────────────────────
    await this.userRepo.save(user);

    // ── Step 6: Publish domain events ─────────────────────────────────────
    // IMPORTANT: Publish AFTER successful persistence.
    // If we published before and then the save fails, consumers would act
    // on an event that never happened.
    const events = user.collectDomainEvents();
    await this.eventPublisher.publishAll(events);

    this.logger.log({
      event: 'user_registered',
      userId: user.id,
      email: email.value,
      username: username.value,
    });

    return {
      userId:   user.id,
      username: user.username.value,
      email:    user.email.value,
    };
  }
}
