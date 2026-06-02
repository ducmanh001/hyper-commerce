import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { KafkaModule } from '@hypercommerce/kafka';
import { RedisModule } from '@hypercommerce/redis';
import { RecommendationService } from './recommendation/recommendation.service';
import { FraudDetectionService } from './fraud/fraud-detection.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule.register({ timeout: 5000, maxRedirects: 3 }),
    KafkaModule,
    RedisModule,
  ],
  providers: [RecommendationService, FraudDetectionService],
  exports: [RecommendationService, FraudDetectionService],
})
export class AppModule {}
