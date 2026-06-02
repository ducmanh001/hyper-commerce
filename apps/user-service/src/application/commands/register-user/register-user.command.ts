/**
 * RegisterUser — Command + Handler
 *
 * CQRS Command: a write operation with clear intent.
 * The command carries the data needed; the handler contains the use-case logic.
 *
 * FLOW:
 *   1. Validate uniqueness (email + username)
 *   2. Hash password (via port — not domain logic, but security concern)
 *   3. Create domain aggregate (validates VOs, emits UserRegisteredEvent)
 *   4. Persist
 *   5. Publish domain events
 *   6. Send welcome email (fire-and-forget, don't block the response)
 *
 * WHY FIRE-AND-FORGET FOR EMAIL:
 *   User registration must succeed even if the email provider is down.
 *   We persist the event to Kafka; notification-service retries independently.
 *   This is eventual consistency — email may arrive seconds later.
 *
 * IDEMPOTENCY:
 *   The uniqueness check (existsByEmail) handles duplicate requests naturally.
 *   If the same email is submitted twice, the second request gets EmailAlreadyTakenException.
 */
export class RegisterUserCommand {
  constructor(
    public readonly email: string,
    public readonly username: string,
    public readonly password: string,   // plain text — will be hashed in handler
    public readonly displayName: string,
  ) {}
}
