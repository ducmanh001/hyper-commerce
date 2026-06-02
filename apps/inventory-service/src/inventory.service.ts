// ============================================================
// HYPERCOMMERCE — Inventory Service
// Hardest business problem in e-commerce: prevent oversell
// while supporting 50K concurrent requests in flash sale.
//
// Architecture: 3-tier stock management
// Tier 1: Redis atomic DECR (< 1ms) — first gate
// Tier 2: Reservation TTL pattern — cart holds stock
// Tier 3: PostgreSQL source of truth — reconciled every 5min
// ============================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import {
  InsufficientStockException,
  NotFoundException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import { ProductStock } from './entities/product-stock.entity';
import { AtomicStockHelper } from './helpers/atomic-stock.helper';
import { FlashSaleService } from './flash-sale/flash-sale.service';

export interface ReserveStockRequest {
  orderId: string;
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
  }>;
}

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(ProductStock)
    private readonly stockRepo: Repository<ProductStock>,
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
    private readonly consumer: KafkaConsumerService,
    private readonly atomicStock: AtomicStockHelper,
    private readonly flashSale: FlashSaleService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Listen for order events to reserve/release stock
    await this.consumer.registerConsumer({
      groupId: 'inventory-consumer',
      topics: [
        APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
        APP_CONSTANTS.KAFKA_TOPICS.ORDER_CANCELLED,
      ],
      handlers: [
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
          handle: this.onOrderEvent.bind(this),
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CANCELLED,
          handle: this.onOrderCancelled.bind(this),
        },
      ],
    });
  }

  /**
   * Reserve stock for an order.
   *
   * Algorithm (3-gate):
   * 1. Redis DECR — atomic, < 1ms, rejects oversell immediately
   * 2. Create DB reservation record (idempotent)
   * 3. Publish stock.reserved or stock.insufficient Kafka event
   *
   * All-or-nothing: if any item fails, release all previous items
   */
  async reserveStock(request: ReserveStockRequest): Promise<void> {
    const reservedItems: string[] = []; // Track for rollback

    try {
      for (const item of request.items) {
        const result = await this.atomicStock.reserve(
          item.productId,
          item.variantId,
          item.quantity,
          request.orderId,
        );

        if (!result.success) {
          // Roll back previously reserved items
          await this.rollbackReservations(request.orderId, reservedItems);

          await this.kafka.publish({
            topic: APP_CONSTANTS.KAFKA_TOPICS.STOCK_INSUFFICIENT,
            partitionKey: item.productId,
            value: {
              type: 'STOCK_INSUFFICIENT',
              orderId: request.orderId,
              productId: item.productId,
              variantId: item.variantId,
              requested: item.quantity,
              available: result.newStock,
            },
          });

          return; // Saga will handle cancellation
        }

        reservedItems.push(item.productId);
      }

      // All items reserved — persist reservation in DB
      await this.persistReservations(request);

      await this.kafka.publish({
        topic: APP_CONSTANTS.KAFKA_TOPICS.STOCK_RESERVED,
        partitionKey: request.orderId,
        value: {
          type: 'STOCK_RESERVED',
          orderId: request.orderId,
          reservationIds: reservedItems,
          expiresAt: new Date(
            Date.now() + APP_CONSTANTS.STOCK_RESERVE_TTL * 1000,
          ).toISOString(),
        },
      });

      this.logger.log(
        JSON.stringify({
          event: 'stock_reserved',
          orderId: request.orderId,
          itemCount: request.items.length,
        }),
      );
    } catch (error) {
      // Unexpected error — ensure cleanup
      await this.rollbackReservations(request.orderId, reservedItems);
      throw error;
    }
  }

  /**
   * Commit reservation — called when payment succeeds.
   * Converts reservation to actual deduction in DB.
   */
  async commitReservation(orderId: string): Promise<void> {
    await this.atomicStock.commitAllReservations(orderId);
    this.logger.log(
      JSON.stringify({ event: 'reservation_committed', orderId }),
    );
  }

  /**
   * Release reservation — called on order cancellation.
   * Returns stock to available pool.
   */
  async releaseReservation(orderId: string): Promise<void> {
    await this.atomicStock.releaseAllReservations(orderId);

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.STOCK_RELEASED,
      partitionKey: orderId,
      value: {
        type: 'STOCK_RELEASED',
        orderId,
        releasedAt: new Date().toISOString(),
      },
    });

    this.logger.log(
      JSON.stringify({ event: 'reservation_released', orderId }),
    );
  }

  /**
   * Get real-time stock level.
   * Returns Redis value (fastest) with DB fallback.
   */
  async getStock(productId: string, variantId?: string): Promise<{
    available: number;
    reserved: number;
    total: number;
  }> {
    const stockKey = this.atomicStock.buildStockKey(productId, variantId);
    const reservedKey = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_RESERVED}${productId}:total`;

    const [availableStr, reservedStr] = await Promise.all([
      this.redis.get(stockKey),
      this.redis.get(reservedKey),
    ]);

    if (availableStr !== null) {
      const available = Number(availableStr);
      const reserved = Number(reservedStr ?? 0);
      return { available, reserved, total: available + reserved };
    }

    // Cache miss — fetch from DB and warm cache
    const dbStock = await this.stockRepo.findOne({
      where: { productId, variantId: variantId ?? undefined },
    });

    if (!dbStock) throw new NotFoundException('ProductStock', productId);

    await this.redis.set(
      stockKey,
      String(dbStock.available),
      300, // 5min cache
    );

    return {
      available: dbStock.available,
      reserved: dbStock.reserved,
      total: dbStock.total,
    };
  }

  // ── Kafka Event Handlers ──────────────────────────────────

  private async onOrderEvent(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    if (event.type !== 'ORDER_CREATED') return;

    const request: ReserveStockRequest = {
      orderId: event.orderId as string,
      items: event.items as ReserveStockRequest['items'],
    };

    await this.reserveStock(request);
  }

  private async onOrderCancelled(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    if (event.type !== 'ORDER_CANCELLED') return;
    await this.releaseReservation(event.orderId as string);
  }

  // ── Internal ──────────────────────────────────────────────

  private async rollbackReservations(
    orderId: string,
    productIds: string[],
  ): Promise<void> {
    await Promise.all(
      productIds.map((productId) =>
        this.atomicStock
          .releaseReservation(productId, undefined, orderId)
          .catch((err) =>
            this.logger.error(
              `Rollback failed for ${productId}: ${String(err)}`,
            ),
          ),
      ),
    );
  }

  private async persistReservations(
    request: ReserveStockRequest,
  ): Promise<void> {
    // Upsert reservation records — idempotent
    await Promise.all(
      request.items.map((item) =>
        this.stockRepo
          .createQueryBuilder()
          .insert()
          .into('order_reservations')
          .values({
            orderId: request.orderId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            expiresAt: new Date(
              Date.now() + APP_CONSTANTS.STOCK_RESERVE_TTL * 1000,
            ),
          })
          .orIgnore() // Idempotent
          .execute(),
      ),
    );
  }
}
