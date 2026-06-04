import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * CorrelationIdMiddleware
 *
 * Injects X-Correlation-ID into every request so logs across microservices
 * can be correlated into a single trace chain.
 *
 * Upstream: accepts existing header (from API gateway / caller)
 * Downstream: generates new UUID if none present
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CorrelationIdMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const existingId = req.headers['x-correlation-id'] as string | undefined;
    const correlationId = existingId ?? uuidv4();

    // Attach to request for downstream use
    req.headers['x-correlation-id'] = correlationId;

    // Echo back in response
    res.setHeader('X-Correlation-ID', correlationId);

    // Attach to response locals for structured logging
    res.locals['correlationId'] = correlationId;

    this.logger.debug(`[${correlationId}] ${req.method} ${req.path}`);
    next();
  }
}
