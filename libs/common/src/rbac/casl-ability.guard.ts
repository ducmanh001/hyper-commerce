/**
 * CaslAbilityGuard
 *
 * How it works:
 * 1. Reads JWT payload from request (already attached by JwtAuthGuard).
 * 2. Calls AbilityFactory.createForUser() — O(n_rules) per request.
 * 3. Caches the Ability on the request object for downstream use.
 * 4. Reads @CheckAbility() handlers from route metadata.
 * 5. Evaluates each handler: RequiredRule → ability.can(); PolicyHandler → callback.
 * 6. Returns true only if ALL handlers pass.
 *
 * Usage:
 *   Apply JwtAuthGuard FIRST (to populate request.user),
 *   then CaslAbilityGuard.
 *
 *   @UseGuards(JwtAuthGuard, CaslAbilityGuard)
 *   @CheckAbility({ action: 'delete', subject: 'User' })
 *   async deleteUser(...)
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AbilityFactory, AppAbility } from './ability.factory';
import {
  CHECK_ABILITY_KEY,
  AbilityCheck,
  RequiredRule,
  PolicyHandler,
} from './ability.decorator';
import { JwtPayload } from './permissions';

/** Narrow from union */
function isRequiredRule(check: AbilityCheck): check is RequiredRule {
  return typeof check === 'object' && 'action' in check && 'subject' in check;
}

@Injectable()
export class CaslAbilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const checks = this.reflector.getAllAndOverride<AbilityCheck[]>(
      CHECK_ABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @CheckAbility() on this handler — allow through (open endpoint).
    if (!checks || checks.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)['user'] as JwtPayload | undefined;

    if (!user) {
      throw new ForbiddenException('No authenticated user on request');
    }

    const ability = this.abilityFactory.createForUser(user);

    // Cache ability on request so controllers can do fine-grained instance checks
    (request as unknown as Record<string, unknown>)['ability'] = ability;

    const allPassed = checks.every((check) => {
      if (isRequiredRule(check)) {
        return ability.can(check.action, check.subject);
      }
      return (check as PolicyHandler)(ability);
    });

    if (!allPassed) {
      throw new ForbiddenException(
        `Insufficient permissions for this operation`,
      );
    }

    return true;
  }
}

/** Helper — extract cached ability from request in controller/service */
export function getAbilityFromRequest(req: Request): AppAbility {
  return (req as unknown as Record<string, unknown>)['ability'] as AppAbility;
}
