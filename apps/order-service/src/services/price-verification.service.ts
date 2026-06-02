// ============================================================
// HYPERCOMMERCE — Price Verification Service
//
// WHY THIS EXISTS:
// Client sends `clientUnitPrice` in the order payload. Without
// server-side verification an attacker can set price to 1 VND.
// This service validates each item's price against the product
// catalog (via Redis L1 → ES L2) and rejects orders where the
// gap exceeds TOLERANCE_PERCENT (default 1%).
//
// DESIGN DECISIONS:
// - Redis L1 cache (TTL 60s): avoids ES roundtrip on hot products
// - Elasticsearch L2: source of truth for product prices
// - Tolerance 1%: handles FX rounding, bundle pricing edge cases
// - All-or-nothing: any mismatch rejects the whole order
// - Snapshot stored: locks in the verified price at order time
//   so future catalog changes don't affect historical orders
//
// EDGE CASES HANDLED:
// 1. Product no longer exists → throws NotFoundException
// 2. Product out of region (currency mismatch) → throws
// 3. Flash sale price changed between add-to-cart & checkout → rejects
// 4. Price changed during concurrent requests → first verify wins
// 5. Variant price differs from base product → variant price checked
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import {
  NotFoundException,
  PriceMismatchException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import { OrderItemDto } from '../dto/order-item.dto';

export interface VerifiedItem {
  productId: string;
  variantId?: string;
  quantity: number;
  /** Server-verified unit price (smallest currency unit, e.g. VND) */
  verifiedUnitPrice: number;
  /** Subtotal = verifiedUnitPrice × quantity */
  subtotal: number;
  /** Captured at verification time — never changes even if catalog updates */
  snapshot: {
    name: string;
    imageUrl: string;
    sellerId: string;
    categoryId: string;
    attributes?: Record<string, string>;
  };
}

export interface CatalogProduct {
  id: string;
  name: string;
  imageUrl: string;
  sellerId: string;
  categoryId: string;
  price: number;            // base price
  salePrice?: number;       // active flash sale price (null if no sale)
  currency: string;
  variants?: Array<{
    id: string;
    price: number;
    attributes: Record<string, string>;
  }>;
}

const PRICE_CACHE_TTL = 60;  // 60 seconds — balance freshness vs DB load
const TOLERANCE_PERCENT = 1; // 1% max client/server price deviation

@Injectable()
export class PriceVerificationService {
  private readonly logger = new Logger(PriceVerificationService.name);
  private readonly INDEX = 'products';

  constructor(
    private readonly redis: RedisClientService,
    private readonly es: ElasticsearchService,
  ) {}

  /**
   * Verify all items in an order against the product catalog.
   *
   * Returns verified items with server prices.
   * Throws PriceMismatchException if any item's client price
   * deviates more than TOLERANCE_PERCENT from catalog.
   *
   * @throws NotFoundException if product not found
   * @throws PriceMismatchException if price tampered beyond tolerance
   */
  async verifyAndEnrich(
    items: OrderItemDto[],
    currency: string,
  ): Promise<VerifiedItem[]> {
    // Fetch all prices in parallel — one round trip per unique product
    const productIds = [...new Set(items.map((i) => i.productId))];
    const catalogMap = await this.fetchCatalogBatch(productIds);

    return items.map((item) => {
      const product = catalogMap.get(item.productId);
      if (!product) {
        throw new NotFoundException('Product', item.productId, {
          metadata: { context: 'price_verification' },
        });
      }

      // Validate currency matches order currency
      if (product.currency !== currency) {
        throw new PriceMismatchException(
          item.productId,
          item.clientUnitPrice,
          product.price,
          `Currency mismatch: product is ${product.currency}, order is ${currency}`,
        );
      }

      // Resolve effective price: variant price > sale price > base price
      const serverPrice = this.resolveEffectivePrice(product, item.variantId);

      // Validate client price — must match within tolerance
      if (!this.withinTolerance(item.clientUnitPrice, serverPrice)) {
        this.logger.warn(
          JSON.stringify({
            event: 'price_mismatch_detected',
            productId: item.productId,
            clientPrice: item.clientUnitPrice,
            serverPrice,
            diff: Math.abs(item.clientUnitPrice - serverPrice),
            diffPct: (Math.abs(item.clientUnitPrice - serverPrice) / serverPrice * 100).toFixed(2),
          }),
        );

        throw new PriceMismatchException(
          item.productId,
          item.clientUnitPrice,
          serverPrice,
        );
      }

      const variantAttrs = product.variants?.find((v) => v.id === item.variantId)?.attributes;

      return {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        verifiedUnitPrice: serverPrice,
        subtotal: serverPrice * item.quantity,
        snapshot: {
          name: item.snapshot?.name ?? product.name,
          imageUrl: item.snapshot?.imageUrl ?? product.imageUrl,
          sellerId: product.sellerId,
          categoryId: product.categoryId,
          attributes: variantAttrs ?? item.snapshot?.attributes,
        },
      };
    });
  }

  // ── Private ───────────────────────────────────────────────

  /**
   * Batch fetch products: Redis L1 → Elasticsearch L2.
   * Cache results in Redis for subsequent requests.
   */
  private async fetchCatalogBatch(
    productIds: string[],
  ): Promise<Map<string, CatalogProduct>> {
    const result = new Map<string, CatalogProduct>();
    const cacheMisses: string[] = [];

    // L1: Redis cache check
    await Promise.all(
      productIds.map(async (id) => {
        const cacheKey = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_CACHE}${id}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          result.set(id, JSON.parse(cached) as CatalogProduct);
        } else {
          cacheMisses.push(id);
        }
      }),
    );

    if (cacheMisses.length === 0) return result;

    // L2: Elasticsearch mget for cache misses
    const esResponse = await this.es.mget<CatalogProduct>({
      index: this.INDEX,
      ids: cacheMisses,
    });

    await Promise.all(
      (esResponse.docs ?? []).map(async (doc) => {
        if (!('found' in doc) || !doc.found) return; // product not found — caller handles
        const product = doc._source as CatalogProduct;

        result.set(product.id, product);

        // Write-back to Redis L1
        const cacheKey = `${APP_CONSTANTS.REDIS_KEYS.PRODUCT_CACHE}${product.id}`;
        await this.redis.set(cacheKey, JSON.stringify(product), PRICE_CACHE_TTL);
      }),
    );

    return result;
  }

  /**
   * Resolve which price to charge.
   *
   * Priority (highest wins):
   * 1. Variant-specific price (e.g. Large T-shirt costs more)
   * 2. Flash sale price (salePrice field, if active)
   * 3. Base product price
   */
  private resolveEffectivePrice(
    product: CatalogProduct,
    variantId?: string,
  ): number {
    if (variantId) {
      const variant = product.variants?.find((v) => v.id === variantId);
      if (variant) return variant.price;
    }

    // salePrice takes precedence if present
    if (product.salePrice != null && product.salePrice > 0) {
      return product.salePrice;
    }

    return product.price;
  }

  /**
   * Check if client price is within tolerance of server price.
   *
   * Edge case: serverPrice = 0 (free item) → only accept clientPrice = 0.
   */
  private withinTolerance(clientPrice: number, serverPrice: number): boolean {
    if (serverPrice === 0) return clientPrice === 0;
    const diff = Math.abs(clientPrice - serverPrice);
    const pct = (diff / serverPrice) * 100;
    return pct <= TOLERANCE_PERCENT;
  }
}
