import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const config = app.get(ConfigService);
  const port = config.get<number>('NOTIFICATION_PORT', 3004);
  await app.listen(port);
  console.warn(`Notification Service running on port ${port}`);
}
bootstrap();
