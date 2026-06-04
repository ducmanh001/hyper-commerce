// ============================================================
// OrderDeliveredConsumer
// Subscribes to order.events → ORDER_DELIVERED
// Triggers loyalty cashback for the buyer.
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import type { WalletService } from '../wallet.service';

interface OrderDeliveredPayload {
  eventType: string;
  orderId: string;
  userId: string;
  totalAmount: number;
  deliveredAt?: string;
}

@Injectable()
export class OrderDeliveredConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderDeliveredConsumer.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly walletService: WalletService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.registerConsumer({
      groupId: 'wallet-order-consumer',
      topics: ['order.events'],
      handlers: [
        {
          topic: 'order.events',
          handle: this.handleOrderEvent.bind(this),
        },
      ],
    });
  }

  private async handleOrderEvent(
    message: Record<string, unknown>,
    _meta: MessageMetadata,
  ): Promise<void> {
    const payload = message as unknown as OrderDeliveredPayload;
    if (payload.eventType !== 'ORDER_DELIVERED') return;

    const { orderId, userId, totalAmount } = payload;
    this.logger.log(
      `Processing cashback for order=${orderId} user=${userId} amount=${totalAmount}`,
    );

    try {
      await this.walletService.processCashback(userId, orderId, totalAmount);
    } catch (err) {
      this.logger.error(`Cashback failed for order=${orderId}`, err);
      throw err; // bubble up → Kafka consumer retries
    }
  }
}
