import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

// Admin JWT guard — separate from customer JWT guard.
// Why separate?
// - Different secret (admin JWT is never issued to customer flows)
// - Different role validation (requires 'admin' or 'ops' role)
// - Different error messages (internal team, not public API)
@Injectable()
export class AdminJwtGuard implements CanActivate {
  private readonly logger = new Logger(AdminJwtGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.tryAuthorizeInternalProxy(request)) {
      return true;
    }

    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Admin token required');
    }

    let payload: { sub: string; role: string; email: string };

    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.ADMIN_JWT_SECRET,
      });
    } catch (err) {
      this.logger.warn(`Admin token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired admin token');
    }

    if (!['admin', 'ops', 'finance', 'trust_safety', 'super_admin'].includes(payload.role)) {
      this.logger.warn(`Access denied for role: ${payload.role} (user: ${payload.sub})`);
      throw new ForbiddenException('Insufficient role for admin access');
    }

    // Attach for downstream controllers / audit logging
    (request as unknown as Record<string, unknown>)['adminUser'] = payload;
    return true;
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.slice(7).trim() || null;
  }

  private tryAuthorizeInternalProxy(request: Request): boolean {
    const internalToken = request.headers['x-internal-token'];
    const expected = process.env.INTERNAL_SERVICE_TOKEN;

    if (!expected || internalToken !== expected) {
      return false;
    }

    const userId = this.getSingleHeader(request, 'x-admin-user-id');
    const role = this.getSingleHeader(request, 'x-admin-user-role');
    const email = this.getSingleHeader(request, 'x-admin-user-email') ?? '';

    if (!userId || !role) {
      throw new UnauthorizedException('Incomplete internal admin context');
    }

    if (!['admin', 'ops', 'finance', 'trust_safety', 'super_admin'].includes(role)) {
      throw new ForbiddenException('Insufficient internal role for admin access');
    }

    (request as unknown as Record<string, unknown>)['adminUser'] = {
      sub: userId,
      role,
      email,
    };

    return true;
  }

  private getSingleHeader(request: Request, key: string): string | null {
    const val = request.headers[key];
    if (Array.isArray(val)) return val[0] ?? null;
    return typeof val === 'string' ? val : null;
  }
}
