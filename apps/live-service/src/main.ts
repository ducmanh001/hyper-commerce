import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveModule } from './live.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(LiveModule);
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const config = app.get(ConfigService);
  const port = config.get<number>('LIVE_PORT', 3007);
  await app.listen(port);
  console.warn(`Live Service running on port ${port} (WebSocket + HTTP)`);
}
bootstrap();
