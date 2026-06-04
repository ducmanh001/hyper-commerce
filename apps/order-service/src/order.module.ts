import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { KafkaConsumerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Voucher } from './entities/voucher.entity';
import { VoucherUsage } from './entities/voucher-usage.entity';
import { Commission } from './entities/commission.entity';
import { Dispute } from './entities/dispute.entity';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderRepository } from './repositories/order.repository';
import { OrderItemRepository } from './repositories/order-item.repository';
import { IdempotencyService } from './idempotency/idempotency.service';
import { OrderSagaOrchestrator } from './saga/order-saga.orchestrator';
import { OutboxProcessorService } from './saga/outbox-processor.service';
import { OrderQueryService } from './services/order-query.service';
import { OrderPriceHelper } from './helpers/order-price.helper';
import { PriceVerificationService } from './services/price-verification.service';
import { VoucherService } from './services/voucher.service';
import { CommissionService } from './services/commission.service';
import { DisputeService } from './services/dispute.service';
import { ShippingCalculatorService } from './services/shipping-calculator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OutboxEvent,
      Voucher,
      VoucherUsage,
      Commission,
      Dispute,
    ]),
    ConfigModule,
    ElasticsearchModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        node: config.get<string>('ELASTICSEARCH_NODE', 'http://elasticsearch:9200'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [OrderController],
  providers: [
    // Core services
    OrderService,
    OrderQueryService,
    // New domain services (Phase 1 improvements)
    PriceVerificationService,
    VoucherService,
    CommissionService,
    DisputeService,
    ShippingCalculatorService,
    // Repositories
    OrderRepository,
    OrderItemRepository,
    // Infrastructure
    KafkaProducerService,
    KafkaConsumerService,
    RedisClientService,
    // Domain helpers
    IdempotencyService,
    OrderSagaOrchestrator,
    // Outbox pattern — polls DB and publishes to Kafka reliably
    OutboxProcessorService,
    OrderPriceHelper,
  ],
  exports: [OrderService, OrderRepository, CommissionService, VoucherService],
})
export class OrderModule {}
