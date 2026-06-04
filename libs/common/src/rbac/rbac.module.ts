/**
 * PermissionsModule
 *
 * Import this module into any NestJS service that needs RBAC/ABAC.
 * Provides: AbilityFactory, CaslAbilityGuard (injectable).
 *
 * @example
 * // In your feature module:
 * \@Module({ imports: [PermissionsModule] })
 * export class OrderModule {}
 */

import { Module } from '@nestjs/common';
import { AbilityFactory } from './ability.factory';
import { CaslAbilityGuard } from './casl-ability.guard';

@Module({
  providers: [AbilityFactory, CaslAbilityGuard],
  exports: [AbilityFactory, CaslAbilityGuard],
})
export class PermissionsModule {}
