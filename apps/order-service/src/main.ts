// ============================================================
// Order Service — Bootstrap
// Swagger + Versioning + Global pipes/filters/interceptors
// + Kafka microservice hybrid
// ============================================================
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '@hypercommerce/common';
import { LoggingInterceptor } from '@hypercommerce/common';
import { TransformInterceptor } from '@hypercommerce/common';
import { StrictValidationPipe } from '@hypercommerce/common';
import { CorrelationIdMiddleware } from '@hypercommerce/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('ORDER_PORT', 3011);
  const env = config.get<string>('NODE_ENV', 'development');

  // ── API prefix + versioning ──────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Security ─────────────────────────────────────────────
  app.enableCors({
    origin: config.get<string>('CORS_ORIGINS', 'http://localhost:3000').split(','),
    credentials: true,
  });

  // ── Global pipes / filters / interceptors ────────────────
  app.useGlobalPipes(new StrictValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // ── Swagger (skip in production for security) ────────────
  if (env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Order Service')
      .setDescription('HYPERCOMMERCE Order Management API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('orders', 'Order CRUD and lifecycle')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  // ── Kafka microservice (listen for saga events) ──────────
  const kafkaBrokers = config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(',');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: { clientId: 'order-service', brokers: kafkaBrokers },
      consumer: { groupId: 'order-service-consumer' },
    },
  });

  await app.startAllMicroservices();
  await app.listen(port);
  logger.log(`Order Service running on port ${port} [${env}]`);
}

bootstrap().catch((err) => {
  console.error('Failed to start order-service', err);
  process.exit(1);
});
