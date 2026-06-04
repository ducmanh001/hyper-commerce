// ============================================================
// HYPERCOMMERCE — Live Stream Service
// Business logic for stream lifecycle, gifts, product showcasing.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import type { Redis } from 'ioredis';
import type { KafkaProducerService } from '@hypercommerce/kafka';

interface Stream {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED';
  currentProduct?: {
    productId: string;
    name: string;
    price: number;
    flashSalePrice?: number;
    stockRemaining?: number;
  };
  startedAt?: Date;
  endedAt?: Date;
}

interface GiftConfig {
  id: string;
  name: string;
  value: number; // Virtual currency value
  realValue: number; // Real money equivalent (VND)
  animationType: 'SMALL' | 'MEDIUM' | 'LARGE' | 'EPIC';
}

// Gift catalog — in production: stored in DB, cached in Redis
const GIFT_CATALOG: Record<string, GiftConfig> = {
  rose: { id: 'rose', name: '🌹 Hoa hồng', value: 1, realValue: 500, animationType: 'SMALL' },
  heart: { id: 'heart', name: '❤️ Trái tim', value: 5, realValue: 2500, animationType: 'SMALL' },
  diamond: {
    id: 'diamond',
    name: '💎 Kim cương',
    value: 100,
    realValue: 50000,
    animationType: 'MEDIUM',
  },
  supercar: {
    id: 'supercar',
    name: '🚗 Siêu xe',
    value: 1000,
    realValue: 500000,
    animationType: 'LARGE',
  },
  spaceship: {
    id: 'spaceship',
    name: '🚀 Tàu vũ trụ',
    value: 10000,
    realValue: 5000000,
    animationType: 'EPIC',
  },
};

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);

  constructor(
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
  ) {}

  async getStream(streamId: string): Promise<Stream | null> {
    const cacheKey = `stream:meta:${streamId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Stream;

    // In production: query DB
    return null;
  }

  /**
   * Process a gift transaction.
   * 1. Check user wallet balance
   * 2. Deduct virtual coins atomically
   * 3. Credit seller (after platform fee)
   * 4. Return success with animation config
   */
  async processGift(
    userId: string,
    streamId: string,
    giftId: string,
    quantity: number,
  ): Promise<{
    success: boolean;
    balance?: number;
    giftValue: number;
    animationType: string;
  }> {
    const gift = GIFT_CATALOG[giftId];
    if (!gift) return { success: false, giftValue: 0, animationType: 'SMALL' };

    const totalCost = gift.value * quantity;
    const walletKey = `wallet:coins:${userId}`;

    // Atomic decrement — prevent negative balance with Lua script
    const result = (await (this.redis.getClient() as Redis).eval(
      `
        local balance = tonumber(redis.call('GET', KEYS[1]) or '0')
        local cost = tonumber(ARGV[1])
        if balance < cost then
          return {0, balance}
        end
        local newBalance = redis.call('DECRBY', KEYS[1], cost)
        return {1, newBalance}
      `,
      1,
      walletKey,
      totalCost,
    )) as [number, number];

    if (result[0] === 0) {
      return { success: false, balance: result[1], giftValue: 0, animationType: 'SMALL' };
    }

    // Async: update DB wallet + credit seller (via Kafka event)
    await this.kafka.publish({
      topic: 'wallet-events',
      partitionKey: userId,
      value: {
        type: 'GIFT_SENT',
        userId,
        streamId,
        giftId,
        quantity,
        totalCost,
        totalRealValue: gift.realValue * quantity,
        sellerId: await this.getStreamSellerId(streamId),
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      giftValue: gift.realValue * quantity,
      animationType: gift.animationType,
    };
  }

  private async getStreamSellerId(streamId: string): Promise<string> {
    const stream = await this.getStream(streamId);
    return stream?.sellerId ?? '';
  }
}
