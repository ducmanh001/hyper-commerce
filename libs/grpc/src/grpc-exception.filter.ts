// libs/grpc/src/grpc-exception.filter.ts
// Maps domain exceptions → gRPC status codes
// Must be applied on all gRPC controllers.

import type { RpcExceptionFilter, ArgumentsHost } from '@nestjs/common';
import { Catch } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

interface DomainError {
  name?: string;
  message?: string;
  statusCode?: number;
}

function toGrpcStatus(err: DomainError): number {
  const name = err.name ?? '';
  const statusCode = err.statusCode ?? 500;

  if (statusCode === 404 || name === 'NotFoundException') {
    return status.NOT_FOUND;
  }
  if (statusCode === 400 || name === 'ValidationException') {
    return status.INVALID_ARGUMENT;
  }
  if (statusCode === 403 || name === 'ForbiddenException') {
    return status.PERMISSION_DENIED;
  }
  if (statusCode === 401 || name === 'UnauthorizedException') {
    return status.UNAUTHENTICATED;
  }
  if (statusCode === 409 || name === 'ConflictException') {
    return status.ALREADY_EXISTS;
  }
  if (statusCode === 429 || name === 'RateLimitException') {
    return status.RESOURCE_EXHAUSTED;
  }
  if (name === 'InsufficientStockException') {
    return status.FAILED_PRECONDITION;
  }

  return status.INTERNAL;
}

@Catch()
export class GrpcExceptionFilter implements RpcExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): Observable<unknown> {
    const err = exception as DomainError;
    const grpcStatus = toGrpcStatus(err);

    return throwError(() => ({
      code: grpcStatus,
      message: err.message ?? 'Internal error',
    }));
  }
}
