// ============================================================
// GiftReceivedConsumer
// Subscribes to live.events → LIVE_GIFT_SENT
// Atomically splits coin value: host 70%, platform 30%.
// ============================================================

import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import type { WalletService } from '../wallet.service';

/** Coin values in VND per gift type (1 coin ≈ 1 VND for simplicity) */
const GIFT_COIN_VALUES: Record<string, number> = {
  ROSE: 10,
  HEART: 50,
  DIAMOND: 500,
  CROWN: 1_000,
  ROCKET: 5_000,
};

interface LiveGiftSentPayload {
  eventType: string;
  eventId: string;
  streamId: string;
  hostUserId: string;
  senderId: string;
  giftType: string;
  quantity: number;
  totalCoinValue?: number; // pre-computed, or derive from giftType * quantity
}

@Injectable()
export class GiftReceivedConsumer implements OnModuleInit {
  private readonly logger = new Logger(GiftReceivedConsumer.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly walletService: WalletService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.registerConsumer({
      groupId: 'wallet-live-consumer',
      topics: ['live.events'],
      handlers: [
        {
          topic: 'live.events',
          handle: this.handleLiveEvent.bind(this),
        },
      ],
    });
  }

  private async handleLiveEvent(
    message: Record<string, unknown>,
    _meta: MessageMetadata,
  ): Promise<void> {
    const payload = message as unknown as LiveGiftSentPayload;
    if (payload.eventType !== 'LIVE_GIFT_SENT') return;

    const { eventId, hostUserId, giftType, quantity, totalCoinValue } = payload;
    const unitValue = GIFT_COIN_VALUES[giftType] ?? 0;
    const coinValue = totalCoinValue ?? unitValue * (quantity ?? 1);

    if (coinValue <= 0) {
      this.logger.warn(`Unknown gift type or zero value: ${giftType}`);
      return;
    }

    this.logger.log(
      `Processing gift split: host=${hostUserId} giftType=${giftType} coins=${coinValue}`,
    );

    try {
      await this.walletService.processGiftSplit(hostUserId, eventId, coinValue);
    } catch (err) {
      this.logger.error(`Gift split failed for eventId=${eventId}`, err);
      throw err;
    }
  }
}
