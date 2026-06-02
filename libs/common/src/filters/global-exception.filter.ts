// ============================================================
// HYPERCOMMERCE — Global Exception Filter
// Normalises all exceptions into structured JSON + emits metrics
// ============================================================

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainException } from '../exceptions/domain.exceptions';

export interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  traceId: string;
  timestamp: string;
  path: string;
  context?: Record<string, unknown>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = (request.headers['x-trace-id'] as string) ?? 'no-trace';

    const body = this.buildErrorResponse(exception, traceId, request.url);

    this.logException(exception, body, request);

    response.status(body.statusCode).json(body);
  }

  private buildErrorResponse(
    exception: unknown,
    traceId: string,
    path: string,
  ): ErrorResponse {
    if (exception instanceof DomainException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        traceId,
        timestamp: exception.timestamp.toISOString(),
        path,
        context: exception.context as Record<string, unknown>,
      };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && 'message' in res
          ? Array.isArray((res as { message: unknown }).message)
            ? ((res as { message: string[] }).message).join(', ')
            : (res as { message: string }).message
          : exception.message;

      return {
        statusCode: exception.getStatus(),
        code: 'HTTP_EXCEPTION',
        message,
        traceId,
        timestamp: new Date().toISOString(),
        path,
      };
    }

    // Unexpected — never expose raw error in production
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      traceId,
      timestamp: new Date().toISOString(),
      path,
    };
  }

  private logException(
    exception: unknown,
    body: ErrorResponse,
    request: Request,
  ): void {
    const logContext = {
      traceId: body.traceId,
      statusCode: body.statusCode,
      code: body.code,
      method: request.method,
      url: request.url,
      userId: (request as Request & { user?: { id: string } }).user?.id,
    };

    if (body.statusCode >= 500) {
      this.logger.error(
        `[${body.code}] ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify(logContext),
      );
    } else if (body.statusCode >= 400) {
      this.logger.warn(`[${body.code}] ${body.message}`, JSON.stringify(logContext));
    }
  }
}
