import { Injectable } from '@nestjs/common';

/**
 * OrderPriceHelper — pure price computation logic.
 *
 * All methods are stateless pure functions — easy to unit test.
 * No DB, no Kafka, no external calls.
 */
@Injectable()
export class OrderPriceHelper {
  /**
   * Compute total from server-verified unit prices.
   * Client-submitted prices are NEVER used — this recalculates from catalog.
   *
   * @param items Array of items with server-verified unitPrice
   */
  computeTotal(items: Array<{ quantity: number; unitPrice: number }>): number {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  /**
   * Apply discount from voucher code.
   * Returns { discountAmount, finalTotal }
   *
   * Real impl would call voucher-service to validate and get discount value.
   * Here we compute from the resolved discount object.
   */
  applyDiscount(
    subtotal: number,
    discount: { type: 'PERCENT' | 'FIXED'; value: number; maxCap?: number },
  ): { discountAmount: number; finalTotal: number } {
    let discountAmount = 0;

    if (discount.type === 'PERCENT') {
      discountAmount = Math.floor((subtotal * discount.value) / 100);
      // Cap maximum discount
      if (discount.maxCap) discountAmount = Math.min(discountAmount, discount.maxCap);
    } else {
      discountAmount = Math.min(discount.value, subtotal); // cannot discount more than subtotal
    }

    return {
      discountAmount,
      finalTotal: subtotal - discountAmount,
    };
  }

  /**
   * Validate that client price matches server price within tolerance.
   * Tolerance: 1% (handles FX rounding).
   *
   * Throws PriceMismatchException if too far off.
   * This prevents price tampering at the API layer.
   */
  validateClientPrice(clientPrice: number, serverPrice: number, tolerancePercent = 1): boolean {
    if (serverPrice === 0) return clientPrice === 0;
    const diff = Math.abs(clientPrice - serverPrice);
    const pct = (diff / serverPrice) * 100;
    return pct <= tolerancePercent;
  }

  /**
   * Compute shipping fee based on method and address.
   * Real impl calls logistics-service for live rates.
   */
  computeShippingFee(method: 'STANDARD' | 'EXPRESS' | 'SAME_DAY', destCity: string): number {
    const baseRates: Record<string, number> = {
      STANDARD: 25_000,
      EXPRESS: 50_000,
      SAME_DAY: 100_000,
    };

    const interCityMultiplier = destCity === 'Hồ Chí Minh' || destCity === 'Hà Nội' ? 1 : 1.5;
    return Math.floor(baseRates[method] * interCityMultiplier);
  }

  /**
   * Format price for display — VND has no decimal places.
   */
  formatPrice(amount: number, currency: string): string {
    if (currency === 'VND') {
      return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount / 100); // cents → dollars
  }
}
