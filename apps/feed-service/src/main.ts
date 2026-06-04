import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const config = app.get(ConfigService);
  const port = config.get<number>('FEED_PORT', 3008);
  await app.listen(port);
  console.warn(`Feed Service running on port ${port}`);
}
bootstrap();
