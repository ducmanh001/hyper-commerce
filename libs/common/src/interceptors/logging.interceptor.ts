// ============================================================
// HYPERCOMMERCE — Logging Interceptor
// Structured JSON log for every request: latency, trace, user
// ============================================================

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const startMs = Date.now();
    const traceId = req.headers['x-trace-id'] ?? 'no-trace';

    return next.handle().pipe(
      tap({
        next: () => {
          const latencyMs = Date.now() - startMs;
          this.logger.log(
            JSON.stringify({
              level: 'info',
              event: 'http_request',
              method: req.method,
              url: req.url,
              status: res.statusCode,
              latency_ms: latencyMs,
              trace_id: traceId,
              user_id: (req as Request & { user?: { id: string } }).user?.id,
            }),
          );
        },
        error: (err: Error) => {
          const latencyMs = Date.now() - startMs;
          this.logger.error(
            JSON.stringify({
              level: 'error',
              event: 'http_error',
              method: req.method,
              url: req.url,
              latency_ms: latencyMs,
              trace_id: traceId,
              error: err.message,
            }),
          );
        },
      }),
    );
  }
}
