import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { Review } from './entities/review.entity';
import { ReviewHelpful } from './entities/review-helpful.entity';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { AdminReviewController } from './admin/admin-review.controller';
import { ReviewProcessor } from './processors/review.processor';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';
import { AiAgentsModule } from '@app/ai-agents';
import { QUEUE_NAMES } from '@hypercommerce/queue';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'postgres'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'hypercommerce'),
        password: config.get('DB_PASSWORD', 'hypercommerce'),
        database: config.get('DB_DATABASE', 'hypercommerce'),
        entities: [Review, ReviewHelpful],
        synchronize: config.get('NODE_ENV') !== 'production',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Review, ReviewHelpful]),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'redis'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.REVIEW_PROCESSING }),
    HttpModule,
    AiAgentsModule,
  ],
  controllers: [ReviewController, AdminReviewController],
  providers: [ReviewService, ReviewProcessor, KafkaProducerService, RedisClientService],
})
export class ReviewModule {}
