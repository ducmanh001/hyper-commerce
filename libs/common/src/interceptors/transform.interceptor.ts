import type { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  correlationId?: string;
}

/**
 * TransformInterceptor
 *
 * Wraps every successful response in a consistent envelope:
 * {
 *   success: true,
 *   data: <original_response>,
 *   timestamp: "2026-05-12T10:00:00.000Z",
 *   correlationId: "uuid"
 * }
 *
 * Registered globally in main.ts.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const correlationId = request.headers?.['x-correlation-id'];

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
        ...(correlationId ? { correlationId } : {}),
      })),
    );
  }
}
