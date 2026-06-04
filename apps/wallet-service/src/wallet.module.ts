import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletOutboxEvent } from './entities/wallet-outbox.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { OrderDeliveredConsumer } from './consumers/order-delivered.consumer';
import { GiftReceivedConsumer } from './consumers/gift-received.consumer';
import { OutboxProcessor } from './processors/outbox.processor';
import { KafkaProducerService, KafkaConsumerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';

@Module({
  imports: [TypeOrmModule.forFeature([WalletTransaction, WalletOutboxEvent]), ConfigModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    OrderDeliveredConsumer,
    GiftReceivedConsumer,
    OutboxProcessor,
    KafkaProducerService,
    KafkaConsumerService,
    RedisClientService,
  ],
})
export class WalletModule {}
