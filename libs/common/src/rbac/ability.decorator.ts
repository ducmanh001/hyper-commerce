/**
 * @CheckAbility() decorator + handler metadata key.
 *
 * Usage on a controller method:
 *   @CheckAbility({ action: 'read', subject: 'Order' })
 *   @CheckAbility((ability) => ability.can('update', someOrderInstance))
 */

import { SetMetadata } from '@nestjs/common';
import type { AppAbility } from './ability.factory';
import type { AppActions, AppSubjects } from './permissions';

export const CHECK_ABILITY_KEY = 'CHECK_ABILITY';

/** Simple object form — most common usage */
export interface RequiredRule {
  action: AppActions;
  subject: AppSubjects;
}

/** Callback form — for instance-level / attribute-based checks */
export type PolicyHandler = (ability: AppAbility) => boolean;

export type AbilityCheck = RequiredRule | PolicyHandler;

/**
 * Attach one or more permission requirements to a route handler.
 * All requirements must pass (AND semantics).
 *
 * @example
 * // Coarse-grained (role-based):
 * \@CheckAbility({ action: 'delete', subject: 'User' })
 *
 * @example
 * // Fine-grained (attribute-based, instance-level):
 * \@CheckAbility((ability) => ability.can('update', myOrderInstance))
 */
export const CheckAbility = (...handlers: AbilityCheck[]) =>
  SetMetadata(CHECK_ABILITY_KEY, handlers);
