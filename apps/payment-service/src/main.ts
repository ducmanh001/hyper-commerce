import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import {
  GlobalExceptionFilter,
  LoggingInterceptor,
  TransformInterceptor,
  StrictValidationPipe,
} from '@hypercommerce/common';

async function bootstrap() {
  const logger = new Logger('PaymentService');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({ origin: config.get<string>('CORS_ORIGINS', '*').split(','), credentials: true });
  app.useGlobalPipes(new StrictValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Payment Service')
      .setDescription('HYPERCOMMERCE Payment API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  const kafkaBrokers = config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(',');
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: { clientId: 'payment-service', brokers: kafkaBrokers },
      consumer: { groupId: 'payment-service-consumer' },
    },
  });

  await app.startAllMicroservices();
  await app.listen(config.get<number>('PAYMENT_PORT', 3003));
  logger.log(`Payment Service running on port ${config.get('PAYMENT_PORT', 3003)}`);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
