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

    if (!['admin', 'ops', 'finance'].includes(payload.role)) {
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
}
