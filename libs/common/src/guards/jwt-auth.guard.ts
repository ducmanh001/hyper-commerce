import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import * as jwt from 'jsonwebtoken';
import { JwtPayload } from '../decorators/current-user.decorator';
import { Request } from 'express';

/**
 * JwtAuthGuard
 *
 * Validates JWT from Authorization: Bearer <token> header.
 * Attaches decoded payload to request.user.
 * Skips validation for @Public() routes.
 *
 * In production, use asymmetric RS256 with public key fetched from
 * auth-service JWKS endpoint and cached locally with TTL.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const token = this.extractTokenFromHeader(request);
    if (!token) throw new UnauthorizedException('Missing authorization token');

    try {
      const secret = process.env.JWT_SECRET ?? 'hypercommerce-dev-secret';
      const payload = jwt.verify(token, secret) as JwtPayload;
      request.user = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
