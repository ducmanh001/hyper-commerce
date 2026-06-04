// ============================================================
// HYPERCOMMERCE — Inventory Reconciler
// Tier 3: PostgreSQL là source of truth.
// Mỗi 5 phút: sync Redis stock với DB stock.
// Phát hiện và sửa discrepancy gây ra bởi:
// - Redis crash (data loss)
// - Network partition
// - Bug trong atomic ops
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { RedisClientService } from '@hypercommerce/redis';
import type { Redis } from 'ioredis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import { ProductStock } from '../entities/product-stock.entity';
import type { AtomicStockHelper } from '../helpers/atomic-stock.helper';

interface DiscrepancyReport {
  productId: string;
  variantId?: string;
  redisStock: number | null;
  dbStock: number;
  action: 'REDIS_MISSING' | 'REDIS_NEGATIVE' | 'LARGE_DIFF';
  correctedTo: number;
}

@Injectable()
export class InventoryReconcilerService {
  private readonly logger = new Logger(InventoryReconcilerService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(ProductStock)
    private readonly stockRepo: Repository<ProductStock>,
    private readonly redis: RedisClientService,
    private readonly atomicStock: AtomicStockHelper,
  ) {}

  /**
   * Scheduled reconciliation — runs every 5 minutes.
   *
   * Strategy:
   * 1. Fetch all active product stocks from DB
   * 2. Compare with Redis values
   * 3. Log discrepancies with severity
   * 4. Correct Redis if drift > threshold
   *
   * Note: We NEVER correct DB from Redis — DB is always source of truth.
   * Redis can be wrong (crash, eviction), DB is persisted.
   *
   * Threshold: >5% diff triggers correction.
   * Small diffs (<5%) are expected due to timing of reservation expiry.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcile(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Reconciler already running — skipping cycle');
      return;
    }

    this.isRunning = true;
    const startMs = Date.now();
    const discrepancies: DiscrepancyReport[] = [];

    try {
      // Process in batches to avoid memory pressure (millions of SKUs)
      const BATCH_SIZE = 500;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const batch = await this.stockRepo.find({
          where: { isActive: true },
          take: BATCH_SIZE,
          skip: offset,
        });

        if (batch.length < BATCH_SIZE) hasMore = false;
        offset += BATCH_SIZE;

        // Pipeline Redis GETs for the batch — 1 round-trip
        const redisValues = await this.fetchRedisStockBatch(batch);

        for (const dbStock of batch) {
          const redisValue = redisValues.get(
            this.atomicStock.buildStockKey(dbStock.productId, dbStock.variantId),
          );

          const report = this.detectDiscrepancy(dbStock, redisValue ?? null);
          if (report) {
            discrepancies.push(report);
            await this.correctRedis(report);
          }
        }
      }

      const durationMs = Date.now() - startMs;

      this.logger.log(
        JSON.stringify({
          event: 'inventory_reconcile_complete',
          discrepancies: discrepancies.length,
          durationMs,
          corrections: discrepancies.filter((d) => d.action !== null).length,
        }),
      );

      if (discrepancies.length > 0) {
        this.logger.warn(
          JSON.stringify({
            event: 'inventory_discrepancies_found',
            count: discrepancies.length,
            samples: discrepancies.slice(0, 5), // Log first 5 for debugging
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manual reconciliation for a specific product.
   * Called after inventory import, supplier update, or manual adjustment.
   */
  async reconcileProduct(productId: string, variantId?: string): Promise<void> {
    const dbStock = await this.stockRepo.findOne({
      where: { productId, variantId: variantId ?? undefined },
    });

    if (!dbStock) {
      this.logger.warn(`Product ${productId} not found for reconciliation`);
      return;
    }

    const stockKey = this.atomicStock.buildStockKey(productId, variantId);
    const redisRaw = await this.redis.get(stockKey);
    const redisValue = redisRaw !== null ? Number(redisRaw) : null;

    const report = this.detectDiscrepancy(dbStock, redisValue);
    if (report) {
      await this.correctRedis(report);
      this.logger.log(JSON.stringify({ event: 'manual_reconcile', productId, report }));
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private async fetchRedisStockBatch(stocks: ProductStock[]): Promise<Map<string, number | null>> {
    const client = this.redis.getClient();
    const pipeline = (client as Redis).pipeline();
    const keys = stocks.map((s) => this.atomicStock.buildStockKey(s.productId, s.variantId));

    for (const key of keys) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();
    const map = new Map<string, number | null>();

    if (!results) return map;

    for (let i = 0; i < keys.length; i++) {
      const [, value] = results[i] as [Error | null, string | null];
      map.set(keys[i], value !== null ? Number(value) : null);
    }

    return map;
  }

  private detectDiscrepancy(
    dbStock: ProductStock,
    redisValue: number | null,
  ): DiscrepancyReport | null {
    const expected = dbStock.available;

    // Case 1: Redis key missing — cache evicted or never set
    if (redisValue === null) {
      return {
        productId: dbStock.productId,
        variantId: dbStock.variantId,
        redisStock: null,
        dbStock: expected,
        action: 'REDIS_MISSING',
        correctedTo: expected,
      };
    }

    // Case 2: Redis shows negative stock — shouldn't happen with Lua guards
    if (redisValue < 0) {
      return {
        productId: dbStock.productId,
        variantId: dbStock.variantId,
        redisStock: redisValue,
        dbStock: expected,
        action: 'REDIS_NEGATIVE',
        correctedTo: expected,
      };
    }

    // Case 3: Large divergence (>10% or >100 units absolute)
    const absDiff = Math.abs(redisValue - expected);
    const pctDiff = expected > 0 ? absDiff / expected : 1;

    if (pctDiff > 0.1 && absDiff > 10) {
      return {
        productId: dbStock.productId,
        variantId: dbStock.variantId,
        redisStock: redisValue,
        dbStock: expected,
        action: 'LARGE_DIFF',
        correctedTo: expected,
      };
    }

    return null; // No discrepancy
  }

  private async correctRedis(report: DiscrepancyReport): Promise<void> {
    await this.atomicStock.setStock(
      report.productId,
      report.variantId,
      report.correctedTo,
      // Set a 10min TTL — will be refreshed on next access
      600,
    );
  }
}
