import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Request, Response } from 'express';

/**
 * TimeoutInterceptor — kills slow requests after configurable timeout.
 *
 * Default: 30 seconds. Override per-route with @SetMetadata('timeout', 5000).
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimeoutInterceptor.name);
  private readonly DEFAULT_TIMEOUT_MS = 30_000;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        this.logger.warn(
          `Request timeout: ${req.method} ${req.url} exceeded ${this.DEFAULT_TIMEOUT_MS}ms`,
        );
        res.status(408).json({ success: false, message: 'Request Timeout' });
      }
    }, this.DEFAULT_TIMEOUT_MS);

    return next.handle().pipe(
      tap(() => {
        clearTimeout(timer);
        const duration = Date.now() - start;
        if (duration > 1000) {
          this.logger.warn(`Slow request: ${req.method} ${req.url} took ${duration}ms`);
        }
      }),
      catchError((err: unknown) => {
        clearTimeout(timer);
        return throwError(() => err);
      }),
    );
  }
}
