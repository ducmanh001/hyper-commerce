/**
 * Domain Exceptions for the User domain
 *
 * WHY DOMAIN EXCEPTIONS (not HTTP exceptions):
 *   Domain exceptions express BUSINESS FAILURES, not transport failures.
 *   "Email already taken" is a domain fact — it's true whether the request
 *   came via REST, gRPC, Kafka, or a CLI script.
 *
 *   HTTP layer (controllers) CATCH domain exceptions and map them to HTTP status codes.
 *   gRPC layer catches the same exceptions and maps to gRPC status codes.
 *   This is the "ports and adapters" (hexagonal) pattern.
 *
 * HIERARCHY:
 *   UserDomainException (base)
 *     ├── EmailAlreadyTakenException       → HTTP 409 Conflict
 *     ├── UsernameAlreadyTakenException    → HTTP 409 Conflict
 *     ├── UserNotFoundException            → HTTP 404 Not Found
 *     ├── InvalidCredentialsException      → HTTP 401 Unauthorized
 *     ├── UserSuspendedException           → HTTP 403 Forbidden
 *     ├── EmailNotVerifiedException        → HTTP 403 Forbidden
 *     ├── AlreadyFollowingException        → HTTP 409 Conflict
 *     └── CannotFollowSelfException        → HTTP 422 Unprocessable
 */

export abstract class UserDomainException extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (required for instanceof checks in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EmailAlreadyTakenException extends UserDomainException {
  readonly code = 'USER_EMAIL_TAKEN';
  constructor(email: string) {
    super(`Email '${email}' is already registered`);
  }
}

export class UsernameAlreadyTakenException extends UserDomainException {
  readonly code = 'USER_USERNAME_TAKEN';
  constructor(username: string) {
    super(`Username '${username}' is already taken`);
  }
}

export class UserNotFoundException extends UserDomainException {
  readonly code = 'USER_NOT_FOUND';
  constructor(identifier: string) {
    super(`User '${identifier}' not found`);
  }
}

export class InvalidCredentialsException extends UserDomainException {
  readonly code = 'USER_INVALID_CREDENTIALS';
  constructor() {
    // Intentionally vague — never tell attacker which field is wrong
    super('Invalid email or password');
  }
}

export class UserSuspendedException extends UserDomainException {
  readonly code = 'USER_SUSPENDED';
  constructor(userId: string) {
    super(`User '${userId}' account is suspended`);
  }
}

export class EmailNotVerifiedException extends UserDomainException {
  readonly code = 'USER_EMAIL_NOT_VERIFIED';
  constructor() {
    super('Please verify your email address before continuing');
  }
}

export class AlreadyFollowingException extends UserDomainException {
  readonly code = 'USER_ALREADY_FOLLOWING';
  constructor(followerId: string, followeeId: string) {
    super(`User '${followerId}' is already following '${followeeId}'`);
  }
}

export class CannotFollowSelfException extends UserDomainException {
  readonly code = 'USER_CANNOT_FOLLOW_SELF';
  constructor(userId: string) {
    super(`User '${userId}' cannot follow themselves`);
  }
}

export class UserDeletedPermanentlyException extends UserDomainException {
  readonly code = 'USER_DELETED';
  constructor(userId: string) {
    super(`User '${userId}' has been permanently deleted`);
  }
}
