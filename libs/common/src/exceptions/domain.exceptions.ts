// ============================================================
// HYPERCOMMERCE — Domain Exception Hierarchy
// Rich exceptions carry context for structured logging & client errors
// ============================================================

import { HttpException, HttpStatus } from '@nestjs/common';

export interface ExceptionContext {
  readonly traceId?: string;
  readonly userId?: string;
  readonly resourceId?: string;
  readonly metadata?: Record<string, unknown>;
}

// Base — all domain exceptions extend this
export class DomainException extends HttpException {
  public readonly code: string;
  public readonly context: ExceptionContext;
  public readonly timestamp: Date;

  constructor(message: string, code: string, status: HttpStatus, context: ExceptionContext = {}) {
    super({ message, code, context }, status);
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
  }
}

// ── Auth ──────────────────────────────────────────────────────
export class UnauthorizedException extends DomainException {
  constructor(reason: string, context?: ExceptionContext) {
    super(reason, 'UNAUTHORIZED', HttpStatus.UNAUTHORIZED, context);
  }
}

export class ForbiddenException extends DomainException {
  constructor(resource: string, action: string, context?: ExceptionContext) {
    super(
      `Access denied: cannot ${action} on ${resource}`,
      'FORBIDDEN',
      HttpStatus.FORBIDDEN,
      context,
    );
  }
}

// ── Resource ──────────────────────────────────────────────────
export class NotFoundException extends DomainException {
  constructor(resource: string, id: string, context?: ExceptionContext) {
    super(`${resource} with id '${id}' not found`, 'NOT_FOUND', HttpStatus.NOT_FOUND, {
      ...context,
      resourceId: id,
    });
  }
}

export class ConflictException extends DomainException {
  constructor(message: string, context?: ExceptionContext) {
    super(message, 'CONFLICT', HttpStatus.CONFLICT, context);
  }
}

// ── Inventory ─────────────────────────────────────────────────
export class InsufficientStockException extends DomainException {
  public readonly productId: string;
  public readonly requested: number;
  public readonly available: number;

  constructor(productId: string, requested: number, available: number) {
    super(
      `Insufficient stock for product ${productId}: requested ${requested}, available ${available}`,
      'INSUFFICIENT_STOCK',
      HttpStatus.CONFLICT,
      { resourceId: productId, metadata: { requested, available } },
    );
    this.productId = productId;
    this.requested = requested;
    this.available = available;
  }
}

export class StockReservationExpiredException extends DomainException {
  constructor(orderId: string, productId: string) {
    super(
      `Stock reservation expired for order ${orderId}`,
      'RESERVATION_EXPIRED',
      HttpStatus.GONE,
      { resourceId: orderId, metadata: { productId } },
    );
  }
}

// ── Order / Payment ───────────────────────────────────────────
export class OrderAlreadyExistsException extends DomainException {
  constructor(idempotencyKey: string) {
    super(
      `Order with idempotency key '${idempotencyKey}' already processed`,
      'ORDER_ALREADY_EXISTS',
      HttpStatus.CONFLICT,
      { metadata: { idempotencyKey } },
    );
  }
}

export class OrderStateTransitionException extends DomainException {
  constructor(orderId: string, from: string, to: string) {
    super(
      `Invalid order state transition: ${from} → ${to}`,
      'INVALID_STATE_TRANSITION',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { resourceId: orderId, metadata: { from, to } },
    );
  }
}

export class PaymentDeclinedException extends DomainException {
  public readonly declineCode: string;

  constructor(orderId: string, declineCode: string) {
    super(
      `Payment declined for order ${orderId}: ${declineCode}`,
      'PAYMENT_DECLINED',
      HttpStatus.PAYMENT_REQUIRED,
      { resourceId: orderId, metadata: { declineCode } },
    );
    this.declineCode = declineCode;
  }
}

export class PaymentAlreadyProcessedException extends DomainException {
  constructor(idempotencyKey: string) {
    super(
      `Payment with key '${idempotencyKey}' already processed`,
      'PAYMENT_ALREADY_PROCESSED',
      HttpStatus.CONFLICT,
      { metadata: { idempotencyKey } },
    );
  }
}

// ── Feed ──────────────────────────────────────────────────────
export class FeedGenerationException extends DomainException {
  constructor(userId: string, cause: string) {
    super(
      `Feed generation failed for user ${userId}: ${cause}`,
      'FEED_GENERATION_FAILED',
      HttpStatus.INTERNAL_SERVER_ERROR,
      { userId },
    );
  }
}

// ── Live ──────────────────────────────────────────────────────
export class StreamNotFoundException extends DomainException {
  constructor(streamId: string) {
    super(`Livestream ${streamId} not found or ended`, 'STREAM_NOT_FOUND', HttpStatus.NOT_FOUND, {
      resourceId: streamId,
    });
  }
}

export class StreamQuotaExceededException extends DomainException {
  constructor(sellerId: string) {
    super(
      `Seller ${sellerId} has reached concurrent stream limit`,
      'STREAM_QUOTA_EXCEEDED',
      HttpStatus.TOO_MANY_REQUESTS,
      { userId: sellerId },
    );
  }
}

// ── Rate Limit ────────────────────────────────────────────────
export class RateLimitExceededException extends DomainException {
  public readonly retryAfter: number;

  constructor(userId: string, endpoint: string, retryAfter: number) {
    super(
      `Rate limit exceeded for ${endpoint}`,
      'RATE_LIMIT_EXCEEDED',
      HttpStatus.TOO_MANY_REQUESTS,
      { userId, metadata: { endpoint, retryAfter } },
    );
    this.retryAfter = retryAfter;
  }
}

// ── Search ────────────────────────────────────────────────────
export class SearchUnavailableException extends DomainException {
  constructor(cause: string) {
    super(
      `Search service temporarily unavailable: ${cause}`,
      'SEARCH_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

// ── Validation ────────────────────────────────────────────────
export class ValidationException extends DomainException {
  public readonly fields: Record<string, string[]>;

  constructor(fields: Record<string, string[]>) {
    super('Request validation failed', 'VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, {
      metadata: { fields },
    });
    this.fields = fields;
  }
}

// ── Pricing ───────────────────────────────────────────────────
/**
 * Thrown when client-submitted price deviates > 1% from catalog price.
 * Prevents price tampering attacks at the API layer.
 */
export class PriceMismatchException extends DomainException {
  public readonly productId: string;
  public readonly clientPrice: number;
  public readonly serverPrice: number;

  constructor(
    productId: string,
    clientPrice: number,
    serverPrice: number,
    detail?: string,
    context?: ExceptionContext,
  ) {
    const pct = serverPrice > 0 ? (Math.abs(clientPrice - serverPrice) / serverPrice) * 100 : 0;
    super(
      detail ??
        `Price mismatch for product ${productId}: client=${clientPrice}, catalog=${serverPrice} (${pct.toFixed(1)}% diff)`,
      'PRICE_MISMATCH',
      HttpStatus.CONFLICT,
      { ...context, resourceId: productId, metadata: { clientPrice, serverPrice } },
    );
    this.productId = productId;
    this.clientPrice = clientPrice;
    this.serverPrice = serverPrice;
  }
}

// ── Voucher ───────────────────────────────────────────────────
export class VoucherExpiredException extends DomainException {
  constructor(code: string, expiresAt: Date, context?: ExceptionContext) {
    super(
      `Voucher '${code}' expired at ${expiresAt.toISOString()}`,
      'VOUCHER_EXPIRED',
      HttpStatus.GONE,
      { ...context, metadata: { code, expiresAt } },
    );
  }
}

export class VoucherExhaustedException extends DomainException {
  constructor(code: string, reason: string, context?: ExceptionContext) {
    super(
      `Voucher '${code}' is no longer available: ${reason}`,
      'VOUCHER_EXHAUSTED',
      HttpStatus.GONE,
      { ...context, metadata: { code, reason } },
    );
  }
}

export class VoucherIneligibleException extends DomainException {
  constructor(code: string, reason: string, context?: ExceptionContext) {
    super(
      `Voucher '${code}' cannot be applied: ${reason}`,
      'VOUCHER_INELIGIBLE',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { ...context, metadata: { code, reason } },
    );
  }
}

// ── Dispute ───────────────────────────────────────────────────
export class DisputeWindowExpiredException extends DomainException {
  constructor(orderId: string, windowDays: number) {
    super(
      `Dispute window (${windowDays} days) has closed for order ${orderId}`,
      'DISPUTE_WINDOW_EXPIRED',
      HttpStatus.GONE,
      { resourceId: orderId, metadata: { windowDays } },
    );
  }
}
