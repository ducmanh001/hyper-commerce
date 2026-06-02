// ============================================================
// HYPERCOMMERCE — Live Service Module
// ============================================================
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@hypercommerce/redis';
import { KafkaModule } from '@hypercommerce/kafka';
import { LiveGateway } from './live.gateway';
import { LiveService } from './live.service';
import { ViewerCountService } from './viewer/viewer-count.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    HttpModule,
    RedisModule,
    KafkaModule,
  ],
  providers: [LiveGateway, LiveService, ViewerCountService],
})
export class LiveModule {}
