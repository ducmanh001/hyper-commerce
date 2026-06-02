import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('HyperCommerce Ads Service')
    .setDescription(
      'Second-price GSP auction engine for sponsored products. ' +
      'Revenue model: CPC (performance) + CPM (brand awareness). ' +
      'Budget management via Redis atomic DECRBY for real-time depletion tracking.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('ads', 'Campaign management and auction endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3012);
}

void bootstrap();
