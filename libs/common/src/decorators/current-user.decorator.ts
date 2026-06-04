import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  roles: string[];
  sellerId?: string;
  iat: number;
  exp: number;
}

/**
 * @CurrentUser() decorator — extracts JWT payload from request.
 * Usage: createOrder(@CurrentUser() user: JwtPayload)
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof JwtPayload | undefined,
    ctx: ExecutionContext,
  ): JwtPayload | string | number | string[] | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
