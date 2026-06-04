import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserRole } from '../decorators/roles.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../decorators/current-user.decorator';

/**
 * RolesGuard — RBAC authorization guard.
 *
 * Works with @Roles() decorator.
 * Assumes JwtAuthGuard has already attached user to request.
 *
 * @example
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('ADMIN')
 * @Delete(':id')
 * deleteUser() {}
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator → allow all authenticated users
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Authentication required');

    const hasRole = requiredRoles.some((role) => user.roles?.includes(role));
    if (!hasRole) {
      throw new ForbiddenException(
        `Requires one of: [${requiredRoles.join(', ')}]. You have: [${user.roles?.join(', ')}]`,
      );
    }

    return true;
  }
}
