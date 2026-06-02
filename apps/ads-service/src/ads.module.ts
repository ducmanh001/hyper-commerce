import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { Campaign } from './entities/campaign.entity';
import { AdImpression } from './entities/ad-impression.entity';
import { AdsBillingProcessor } from './processors/ads-billing.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, AdImpression]),
    BullModule.registerQueue({ name: 'ads-events' }),
  ],
  controllers: [AdsController],
  providers: [AdsService, AdsBillingProcessor],
  exports: [AdsService],
})
export class AdsModule {}
