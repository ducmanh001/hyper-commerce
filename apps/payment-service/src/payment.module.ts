import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Payment } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './repositories/payment.repository';
import { RefundRepository } from './repositories/refund.repository';
import { PaymentProcessorFactory } from './processors/payment-processor.factory';
import { StripeProcessor } from './processors/stripe.processor';
import { VnpayProcessor } from './processors/vnpay.processor';
import { MomoProcessor } from './processors/momo.processor';
import { CodProcessor } from './processors/cod.processor';
import { WebhookController } from './webhooks/webhook.controller';
import { KafkaProducerService, KafkaConsumerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';
import { IdempotencyService } from '../../order-service/src/idempotency/idempotency.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, Refund]), ConfigModule],
  controllers: [PaymentController, WebhookController],
  providers: [
    PaymentService,
    PaymentRepository,
    RefundRepository,
    PaymentProcessorFactory,
    StripeProcessor,
    VnpayProcessor,
    MomoProcessor,
    CodProcessor,
    KafkaProducerService,
    KafkaConsumerService,
    RedisClientService,
    IdempotencyService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
