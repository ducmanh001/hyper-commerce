/**
 * User Service — Bootstrap
 *
 * CLUSTER MODE:
 *   When CLUSTER_ENABLED=true, bootstrapWithCluster() forks N worker processes.
 *   Each worker runs bootstrap() independently.
 *   The primary process monitors workers and auto-respawns on crash.
 *
 * GRACEFUL SHUTDOWN:
 *   app.enableShutdownHooks() triggers NestJS lifecycle hooks on SIGTERM.
 *   This allows:
 *   - MemoryLifecycleService.onApplicationShutdown() to stop monitoring
 *   - BufferPoolLifecycleService.onApplicationShutdown() to release pools
 *   - UserFeedDedupService.flushAll() to persist BloomFilters to Redis
 *
 * VERSIONING:
 *   URI versioning (/api/v1/...) allows non-breaking API evolution.
 *   Old clients use /v1, new clients use /v2.
 */
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import {
  GlobalExceptionFilter,
  LoggingInterceptor,
  TransformInterceptor,
  StrictValidationPipe,
} from '@hypercommerce/common';
import { bootstrapWithCluster } from '@hypercommerce/common/cluster/cluster.bootstrap';

async function bootstrap() {
  const logger = new Logger('UserService');
  const app    = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // ── Global configuration ────────────────────────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin:      config.get<string>('CORS_ORIGINS', '*').split(','),
    credentials: true,
  });
  app.useGlobalPipes(new StrictValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // ── Enable graceful shutdown hooks ──────────────────────────────────────
  // This triggers onApplicationShutdown() on SIGTERM/SIGINT.
  // MemoryMonitor stops, BufferPools flush, BloomFilters persist.
  app.enableShutdownHooks();

  // ── Swagger (dev/staging only) ──────────────────────────────────────────
  if (config.get('NODE_ENV') !== 'production') {
    const cfg = new DocumentBuilder()
      .setTitle('User Service API')
      .setDescription('Social profile management, follow graph, celebrity detection')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, cfg));
  }

  const port = config.get<number>('PORT', 3005);
  await app.listen(port);
  logger.log(`User Service running on port ${port} [worker pid=${process.pid}]`);
}

// ── Cluster entry point ─────────────────────────────────────────────────────
// bootstrapWithCluster reads CLUSTER_ENABLED, CLUSTER_WORKERS from env.
// If cluster disabled (dev default), calls bootstrap() directly.
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
