// ============================================================
// HYPERCOMMERCE — Atomic Stock Helper
// Wrappers around Redis Lua scripts cho inventory operations.
// Layer 1 của 3-tier stock management.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

export interface StockReserveResult {
  success: boolean;
  newStock: number;
  error?: 'NOT_FOUND' | 'INSUFFICIENT';
}

@Injectable()
export class AtomicStockHelper {
  private readonly logger = new Logger(AtomicStockHelper.name);

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Atomically reserve stock in Redis.
   *
   * Creates two Redis keys:
   * - inv:stock:{productId}:{variantId} — decremented by quantity
   * - inv:reserved:{productId}:{orderId} — reservation marker with TTL
   *
   * TTL on reservation = 15 minutes.
   * If checkout not completed, TTL expires → stock auto-restored
   * by Redis (no cron job needed).
   */
  async reserve(
    productId: string,
    variantId: string | undefined,
    quantity: number,
    orderId: string,
  ): Promise<StockReserveResult> {
    const stockKey = this.buildStockKey(productId, variantId);
    const reservationKey = this.buildReservationKey(productId, variantId, orderId);

    const result = await this.redis.reserveStock(
      stockKey,
      reservationKey,
      quantity,
      APP_CONSTANTS.STOCK_RESERVE_TTL,
    );

    if (!result.success) {
      this.logger.warn(
        JSON.stringify({
          event: 'stock_reserve_failed',
          productId,
          variantId,
          quantity,
          available: result.newStock,
          error: result.error,
        }),
      );
    }

    return result;
  }

  /**
   * Release a specific reservation — restore stock atomically.
   * Idempotent: if reservation key doesn't exist, no-op.
   */
  async releaseReservation(
    productId: string,
    variantId: string | undefined,
    orderId: string,
  ): Promise<number> {
    const stockKey = this.buildStockKey(productId, variantId);
    const reservationKey = this.buildReservationKey(productId, variantId, orderId);

    const released = await this.redis.releaseReservation(stockKey, reservationKey);

    this.logger.log(
      JSON.stringify({
        event: 'stock_reservation_released',
        productId,
        orderId,
        released,
      }),
    );

    return released;
  }

  /**
   * Release all reservations for an order.
   * Called on order cancellation or payment failure.
   *
   * Fetches all reservation keys for this order from Redis
   * using a scan pattern — avoids storing a list of keys separately.
   */
  async releaseAllReservations(orderId: string): Promise<void> {
    const pattern = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_RESERVED}*:${orderId}`;
    const keys = await this.scanKeys(pattern);

    if (!keys.length) return;

    // Release each reservation and restore stock
    await Promise.all(
      keys.map(async (reservationKey) => {
        // Extract stock key from reservation key
        // Format: inv:reserved:{productId}:{orderId}
        const stockKey = reservationKey
          .replace(APP_CONSTANTS.REDIS_KEYS.PRODUCT_RESERVED, APP_CONSTANTS.REDIS_KEYS.PRODUCT_STOCK)
          .replace(`:${orderId}`, '');

        await this.redis.releaseReservation(stockKey, reservationKey);
      }),
    );

    this.logger.log(
      JSON.stringify({
        event: 'all_reservations_released',
        orderId,
        count: keys.length,
      }),
    );
  }

  /**
   * Commit all reservations for an order.
   * Called when payment succeeds — reservation becomes permanent deduction.
   * Removes reservation key, keeps stock key decremented.
   */
  async commitAllReservations(orderId: string): Promise<void> {
    const pattern = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_RESERVED}*:${orderId}`;
    const keys = await this.scanKeys(pattern);

    if (keys.length) {
      await this.redis.del(...keys);
    }

    this.logger.log(
      JSON.stringify({
        event: 'reservations_committed',
        orderId,
        count: keys.length,
      }),
    );
  }

  /**
   * Set initial stock in Redis from DB sync.
   * Called by reconciler or when product goes live.
   */
  async setStock(
    productId: string,
    variantId: string | undefined,
    quantity: number,
    ttlSeconds?: number,
  ): Promise<void> {
    const key = this.buildStockKey(productId, variantId);
    await this.redis.set(key, String(quantity), ttlSeconds);
  }

  /**
   * Direct atomic decrement — used for non-reserved purchases (buy-now).
   * Flash sale uses this path directly.
   */
  async atomicDecrement(
    productId: string,
    variantId: string | undefined,
    quantity: number,
  ): Promise<StockReserveResult> {
    const stockKey = this.buildStockKey(productId, variantId);
    return this.redis.atomicDecrementStock(stockKey, quantity);
  }

  // ── Key Builders ──────────────────────────────────────────

  buildStockKey(productId: string, variantId?: string): string {
    const base = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_STOCK}${productId}`;
    return variantId ? `${base}:${variantId}` : base;
  }

  buildReservationKey(
    productId: string,
    variantId: string | undefined,
    orderId: string,
  ): string {
    const base = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_RESERVED}${productId}`;
    const withVariant = variantId ? `${base}:${variantId}` : base;
    return `${withVariant}:${orderId}`;
  }

  // ── Internal ──────────────────────────────────────────────

  /**
   * Redis SCAN — safe alternative to KEYS for production.
   * KEYS blocks Redis, SCAN is non-blocking but slower.
   * Used only on write paths (cancellation) — not hot read paths.
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const client = this.redis.getClient() as import('ioredis').Redis;
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [newCursor, batch] = await client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = newCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}
