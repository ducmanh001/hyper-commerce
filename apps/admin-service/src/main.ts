// ============================================================
// HYPERCOMMERCE — Admin Service
// Internal business intelligence & operations dashboard backend.
//
// WHY A SEPARATE SERVICE (not API gateway route)?
// - Heavy aggregation queries should not share resources with
//   customer-facing services (noisy neighbor problem)
// - Different auth model: internal SSO/LDAP, not customer JWT
// - Different rate limits: admin bulk operations are expensive
// - Can query multiple DBs without affecting customer latency
//
// PORT: 3011
// AUTH: Internal JWT (separate secret, longer TTL)
// ACCESS: VPN-only or internal network
// ============================================================

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AdminAppModule } from './admin-app.module';

const logger = new Logger('AdminService');

async function bootstrap() {
  const app = await NestFactory.create(AdminAppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Strict validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger for internal team
  const config = new DocumentBuilder()
    .setTitle('HyperCommerce Admin API')
    .setDescription('Internal admin & business intelligence API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('analytics', 'Business analytics & GMV')
    .addTag('sellers', 'Seller management & commission')
    .addTag('disputes', 'Dispute management')
    .addTag('users', 'User management')
    .addTag('system', 'System health & config')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.ADMIN_PORT ?? 3011;
  await app.listen(port);

  logger.log(`Admin Service running on port ${port}`);
  logger.log(`Swagger: http://localhost:${port}/api`);
}

void bootstrap();
