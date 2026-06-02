import { SetMetadata } from '@nestjs/common';

export type UserRole = 'USER' | 'SELLER' | 'ADMIN' | 'SUPER_ADMIN';

export const ROLES_KEY = 'roles';

/**
 * @Roles('ADMIN', 'SUPER_ADMIN')
 * Works in conjunction with RolesGuard.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
