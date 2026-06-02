/**
 * AuditInterceptor
 *
 * Automatically records admin operations into the audit log.
 * Attach globally in admin-service main.ts or per-controller.
 *
 * Records: actorId, action, resource, before/after diffs, outcome.
 * Non-mutating GET requests are skipped by default (configurable).
 *
 * @example
 * // In AdminModule providers:
 * { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { AuditAction } from './audit.entity';
import { JwtPayload } from '../rbac/permissions';

/** Map HTTP method → AuditAction */
const METHOD_ACTION: Record<string, AuditAction> = {
  POST:   'CREATE',
  PUT:    'UPDATE',
  PATCH:  'UPDATE',
  DELETE: 'DELETE',
};

/** Decorator: skip audit log for a specific handler */
export const SKIP_AUDIT = 'SKIP_AUDIT';
export const SkipAudit = () => Reflector.createDecorator<boolean>()(true);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) return next.handle();

    const req    = context.switchToHttp().getRequest<Request>();
    const method = req.method.toUpperCase();

    // Only audit mutating requests
    if (!METHOD_ACTION[method]) return next.handle();

    const action   = METHOD_ACTION[method];
    const user     = (req as unknown as Record<string, unknown>)['user'] as JwtPayload | undefined;
    const traceId  = req.headers['x-trace-id'] as string | undefined;
    const segments = req.path.split('/').filter(Boolean);
    const resource = segments[1] ?? segments[0] ?? 'unknown';
    const resourceId = segments[2];

    if (!user) return next.handle();

    const startAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.auditService.log({
          actorId:    user.sub,
          actorEmail: user.email,
          actorRole:  user.role,
          action,
          resource,
          resourceId,
          ipAddress:  req.ip,
          userAgent:  req.get('user-agent'),
          traceId,
          success:    true,
          changes:    {
            method,
            path:    req.path,
            body:    this.sanitiseBody(req.body as Record<string, unknown>),
            ms:      Date.now() - startAt,
          },
        });
      }),
      catchError((err: Error) => {
        this.auditService.log({
          actorId:      user.sub,
          actorEmail:   user.email,
          actorRole:    user.role,
          action,
          resource,
          resourceId,
          ipAddress:    req.ip,
          userAgent:    req.get('user-agent'),
          traceId,
          success:      false,
          errorMessage: err.message,
        });
        return throwError(() => err);
      }),
    );
  }

  /** Strip sensitive fields before storing in audit log */
  private sanitiseBody(body: Record<string, unknown> = {}): Record<string, unknown> {
    const SENSITIVE = new Set(['password', 'token', 'secret', 'cardNumber', 'cvv', 'pin']);
    return Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, SENSITIVE.has(k) ? '[REDACTED]' : v]),
    );
  }
}
