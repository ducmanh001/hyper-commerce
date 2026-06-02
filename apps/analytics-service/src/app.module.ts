import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KafkaModule } from '@hypercommerce/kafka';
import { EventCollectorService } from './event-collector.service';
import { ClickHouseService } from './clickhouse/clickhouse.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    KafkaModule,
  ],
  controllers: [AnalyticsController],
  providers: [EventCollectorService, ClickHouseService],
})
export class AppModule {}
