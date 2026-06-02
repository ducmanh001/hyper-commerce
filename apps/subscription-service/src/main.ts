import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('HyperCommerce Subscription Service')
    .setDescription(
      'Recurring revenue via seller subscription plans. ' +
      'Plans: FREE → BASIC (₫299K) → PROFESSIONAL (₫799K) → ENTERPRISE. ' +
      'Commission discount and feature unlocks per tier. ' +
      'Billing via Stripe Subscriptions with webhook for payment events.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('subscriptions')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3013);
}

void bootstrap();
