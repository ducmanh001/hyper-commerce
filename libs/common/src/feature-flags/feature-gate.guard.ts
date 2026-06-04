/**
 * @FeatureGate() decorator
 *
 * Guards an endpoint or method behind a feature flag.
 * Returns 403 when the flag is disabled for the requesting user.
 *
 * @example
 * \@FeatureGate('live-commerce-v2')
 * \@Post('live/start')
 * async startLive(...)
 */

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, ForbiddenException, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { FeatureFlagService } from './feature-flag.service';
import type { JwtPayload } from '../rbac/permissions';

export const FEATURE_GATE_KEY = 'FEATURE_GATE';
export const FeatureGate = (flagKey: string) => SetMetadata(FEATURE_GATE_KEY, flagKey);

@Injectable()
export class FeatureGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_GATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!key) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload | undefined;
    const userId = user?.sub;
    const sellerId = user?.sellerId;

    const enabled = await this.featureFlagService.isEnabled(key, userId, sellerId);
    if (!enabled) throw new ForbiddenException(`Feature '${key}' is not available`);
    return true;
  }
}
