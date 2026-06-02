// ============================================================
// HYPERCOMMERCE — OpenTelemetry Tracing Library
// Distributed tracing across all microservices.
// Trace context propagated via:
// - HTTP headers: traceparent, tracestate (W3C standard)
// - Kafka message headers: trace_id, span_id
// ============================================================

import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace, context, propagation, Tracer } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

// ── Tracing Service ───────────────────────────────────────────

export class TracingService {
  private readonly tracer: Tracer;

  constructor(serviceName: string) {
    this.tracer = trace.getTracer(serviceName);
  }

  /**
   * Create a span for tracking an operation.
   * Use for: DB queries, external HTTP calls, Kafka publishes.
   */
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const span = this.tracer.startSpan(name, { attributes });
    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = await context.with(ctx, fn);
      span.setStatus({ code: 0 }); // SpanStatusCode.OK
      return result;
    } catch (error) {
      span.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Extract trace context from incoming HTTP request.
   * Used by Kafka consumers to continue the distributed trace.
   */
  extractContext(headers: Record<string, string | string[] | undefined>): ReturnType<typeof context.active> {
    return propagation.extract(context.active(), headers);
  }

  /**
   * Inject trace context into outgoing HTTP headers or Kafka headers.
   */
  injectContext(carrier: Record<string, string>): void {
    propagation.inject(context.active(), carrier);
  }

  getActiveTraceId(): string | undefined {
    const span = trace.getActiveSpan();
    if (!span) return undefined;
    const ctx = span.spanContext();
    return ctx.traceId;
  }
}

// ── Tracing Interceptor ───────────────────────────────────────

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  private readonly tracer = trace.getTracer('http-requests');

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = executionContext.switchToHttp().getRequest<Request>();
    const span = this.tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.user_agent': req.headers['user-agent'] ?? '',
        'user.id': (req as Request & { userId?: string }).userId ?? '',
      },
    });

    return next.handle().pipe(
      tap({
        complete: () => {
          const res = executionContext.switchToHttp().getResponse<{ statusCode: number }>();
          span.setAttribute('http.status_code', res.statusCode);
          span.setStatus({ code: res.statusCode < 400 ? 0 : 2 });
          span.end();
        },
        error: (err: Error) => {
          span.setStatus({ code: 2, message: err.message });
          span.recordException(err);
          span.end();
        },
      }),
    );
  }
}

// ── Bootstrap function ────────────────────────────────────────

export function initTracing(serviceName: string, jaegerEndpoint: string): void {
  const exporter = new OTLPTraceExporter({ url: jaegerEndpoint });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: process.env.APP_VERSION ?? '1.0.0',
    }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider.addSpanProcessor(new BatchSpanProcessor(exporter as any));
  provider.register({
    propagator: new W3CTraceContextPropagator(),
  });
}

// ── Module ────────────────────────────────────────────────────

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TracingService,
      useFactory: (config: ConfigService) =>
        new TracingService(config.get('SERVICE_NAME', 'hypercommerce')),
      inject: [ConfigService],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [TracingService],
})
export class TracingModule {}
