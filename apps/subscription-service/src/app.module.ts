import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SellerSubscription } from './entities/seller-subscription.entity';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [SubscriptionPlan, SellerSubscription],
        synchronize: config.get<string>('NODE_ENV') !== 'production',
        poolSize: 5,
        extra: { application_name: 'subscription-service' },
      }),
    }),

    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'single',
        url: config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      }),
    }),

    TypeOrmModule.forFeature([SubscriptionPlan, SellerSubscription]),
  ],
  providers: [SubscriptionService],
  controllers: [SubscriptionController],
})
export class AppModule {}
