// ============================================================
// HYPERCOMMERCE — Flash Sale Service
// Bài toán cực đoan nhất: 50K concurrent requests in 3 seconds.
//
// Problem: Seller livestream, 50K viewers, hét "FLASH SALE 100 cái",
// 50K người bấm mua cùng lúc.
//
// Solution: Redis List queue + Lua atomic dequeue
// 1. All 50K requests LPUSH vào Redis queue (< 1ms each)
// 2. Single worker atomic RPOP batch 100 via Lua
// 3. Process first 100 winners, reject rest with "sold out"
// 4. Push real-time result via WebSocket to all viewers
//
// Why RPOP (not LPOP)?
// LPUSH + RPOP = FIFO queue = first-come-first-served
// Fair ordering = prevents exploitation by retry bots
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import type { RedisClientService } from '@hypercommerce/redis';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import { FlashSale } from './entities/flash-sale.entity';
import type { AtomicStockHelper } from '../helpers/atomic-stock.helper';

export interface FlashSaleRequest {
  saleId: string;
  userId: string;
  productId: string;
  quantity: number;
  requestId: string; // For idempotency
  requestedAt: number; // Unix timestamp ms — for FIFO ordering
}

export interface FlashSaleResult {
  userId: string;
  requestId: string;
  won: boolean;
  orderId?: string;
  position?: number;
  reason?: 'SOLD_OUT' | 'DUPLICATE' | 'SALE_ENDED';
}

@Injectable()
export class FlashSaleService {
  private readonly logger = new Logger(FlashSaleService.name);

  private readonly QUEUE_PREFIX = APP_CONSTANTS.REDIS_KEYS.FLASH_SALE_QUEUE;
  private readonly WINNERS_PREFIX = APP_CONSTANTS.REDIS_KEYS.FLASH_SALE_WINNERS;
  private readonly BATCH_SIZE = APP_CONSTANTS.FLASH_SALE_BATCH_SIZE; // 100

  constructor(
    @InjectRepository(FlashSale)
    private readonly flashSaleRepo: Repository<FlashSale>,
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
    private readonly atomicStock: AtomicStockHelper,
  ) {}

  /**
   * Submit flash sale request — enqueue atomically.
   *
   * LPUSH is O(1) and atomic — 50K concurrent LPUSHes
   * will all succeed in order without contention.
   *
   * Returns queue position immediately — user sees their position
   * in real-time via WebSocket while waiting for processing.
   */
  async submitRequest(req: FlashSaleRequest): Promise<{ queued: boolean; position: number }> {
    const queueKey = `${this.QUEUE_PREFIX}${req.saleId}`;
    const dedupKey = `${this.QUEUE_PREFIX}dedup:${req.saleId}:${req.userId}`;

    // Deduplication — one request per user per sale
    const alreadyQueued = await this.redis.getClient().set(dedupKey, '1', 'EX', 3600, 'NX');

    if (alreadyQueued !== 'OK') {
      return { queued: false, position: -1 };
    }

    const payload = JSON.stringify({
      userId: req.userId,
      requestId: req.requestId,
      productId: req.productId,
      quantity: req.quantity,
      requestedAt: req.requestedAt,
    });

    // LPUSH to front — queue grows from right (RPOP = first in, first out)
    const queueLen = await this.redis.lpush(queueKey, payload);

    this.logger.log(
      JSON.stringify({
        event: 'flash_sale_queued',
        saleId: req.saleId,
        userId: req.userId,
        position: queueLen,
      }),
    );

    return { queued: true, position: queueLen };
  }

  /**
   * Process flash sale queue — called by scheduled worker every 100ms.
   * Uses Lua atomic dequeue to get next batch of winners.
   *
   * Processing:
   * 1. RPOP batch (Lua atomic) — get 100 requests
   * 2. Check remaining stock
   * 3. Winners: atomic DECR stock, create order
   * 4. Losers: mark as SOLD_OUT
   * 5. Publish results via Kafka → WebSocket push to each user
   */
  async processBatch(saleId: string): Promise<FlashSaleResult[]> {
    const queueKey = `${this.QUEUE_PREFIX}${saleId}`;
    const sale = await this.flashSaleRepo.findOne({ where: { id: saleId } });

    if (!sale || sale.status === 'ENDED') {
      return [];
    }

    // Atomic batch dequeue — Lua script ensures no race condition
    const rawBatch = await this.redis.flashSaleDequeue(queueKey, this.BATCH_SIZE);
    if (!rawBatch.length) return [];

    const requests = rawBatch
      .map((raw) => {
        try {
          return JSON.parse(raw) as Omit<FlashSaleRequest, 'saleId'>;
        } catch {
          return null;
        }
      })
      .filter((r): r is Omit<FlashSaleRequest, 'saleId'> => r !== null);

    const results: FlashSaleResult[] = [];

    for (const req of requests) {
      // Atomic stock decrement — one at a time ensures correct ordering
      const stockResult = await this.atomicStock.atomicDecrement(
        req.productId,
        undefined,
        req.quantity,
      );

      const result: FlashSaleResult = {
        userId: req.userId,
        requestId: req.requestId,
        won: stockResult.success,
      };

      if (stockResult.success) {
        // Winner — create flash order
        result.orderId = uuidv4();
        result.position = requests.indexOf(req) + 1;

        // Track winner for dedup
        await this.redis.sadd(`${this.WINNERS_PREFIX}${saleId}`, req.userId);

        await this.kafka.publish({
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
          partitionKey: req.userId,
          value: {
            type: 'FLASH_SALE_ORDER_CREATED',
            orderId: result.orderId,
            userId: req.userId,
            saleId,
            productId: req.productId,
            quantity: req.quantity,
            unitPrice: sale.flashPrice,
          },
        });
      } else {
        result.reason = stockResult.error === 'NOT_FOUND' ? 'SALE_ENDED' : 'SOLD_OUT';

        // If stock exhausted, mark sale as ended
        if (stockResult.error === 'INSUFFICIENT' && stockResult.newStock <= 0) {
          await this.endSale(saleId);
        }
      }

      results.push(result);
    }

    // Publish all results in batch — WebSocket hub pushes to each user
    await this.kafka.publishBatch({
      topic: APP_CONSTANTS.KAFKA_TOPICS.NOTIFICATION_DISPATCH,
      messages: results.map((r) => ({
        key: r.userId,
        value: {
          type: 'FLASH_SALE_RESULT',
          ...r,
          saleId,
        },
      })),
    });

    this.logger.log(
      JSON.stringify({
        event: 'flash_sale_batch_processed',
        saleId,
        total: requests.length,
        winners: results.filter((r) => r.won).length,
        losers: results.filter((r) => !r.won).length,
      }),
    );

    return results;
  }

  /**
   * Start flash sale — pre-warm Redis stock.
   *
   * Why pre-warm? When flash sale starts, there will be massive
   * read + write load. DB cannot handle 50K concurrent stock reads.
   * Pre-loading to Redis means all stock checks are in-memory.
   */
  async startSale(saleId: string): Promise<void> {
    const sale = await this.flashSaleRepo.findOne({ where: { id: saleId } });
    if (!sale) throw new Error(`Flash sale ${saleId} not found`);

    // Pre-warm Redis stock
    await this.atomicStock.setStock(
      sale.productId,
      undefined,
      sale.quantity,
      3_600, // 1 hour TTL — sale should end before this
    );

    await this.flashSaleRepo.update(saleId, { status: 'ACTIVE' });

    this.logger.log(
      JSON.stringify({
        event: 'flash_sale_started',
        saleId,
        quantity: sale.quantity,
        flashPrice: sale.flashPrice,
      }),
    );
  }

  async endSale(saleId: string): Promise<void> {
    await this.flashSaleRepo.update(saleId, { status: 'ENDED' });

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.LIVE_EVENTS,
      partitionKey: saleId,
      value: {
        type: 'FLASH_SALE_ENDED',
        saleId,
        endedAt: new Date().toISOString(),
      },
    });
  }

  async getQueueLength(saleId: string): Promise<number> {
    return this.redis.llen(`${this.QUEUE_PREFIX}${saleId}`);
  }

  async getWinnerCount(saleId: string): Promise<number> {
    return this.redis.sismember(`${this.WINNERS_PREFIX}${saleId}`, '*') as unknown as number;
  }
}
