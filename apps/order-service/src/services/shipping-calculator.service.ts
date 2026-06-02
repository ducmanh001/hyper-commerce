// ============================================================
// HYPERCOMMERCE — Shipping Calculator Service
//
// WHY A DEDICATED SERVICE?
// Shipping is a key conversion factor in Vietnamese e-commerce.
// Complex rules: zone-based pricing, weight tiers, express surcharges,
// seller-subsidized shipping, free shipping thresholds.
//
// DESIGN:
// - Zone matrix: VN divided into 3 zones (same-city, same-region, cross-region)
// - Weight tiers: 0-500g, 500g-1kg, 1kg-5kg, 5kg+
// - Method premiums: STANDARD=base, EXPRESS=2×base, SAME_DAY=4×base
// - Free shipping: when order total ≥ threshold (seller-configured)
// - Voucher override: FREE_SHIPPING voucher zeroes fee
//
// IN PRODUCTION: replace zone lookup with real logistics API
// (Giao Hang Nhanh, GHTK, ViettelPost) via adapter pattern.
// This service is the adapter facade — swappable without changing
// order-service logic.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';

export type ShippingMethod = 'STANDARD' | 'EXPRESS' | 'SAME_DAY';
export type ShippingZone = 'SAME_CITY' | 'SAME_REGION' | 'CROSS_REGION';

export interface ShippingCalculationInput {
  method: ShippingMethod;
  originCity: string;     // seller warehouse city
  destinationCity: string;
  weightGrams: number;    // total order weight
  orderTotal: number;     // to check free shipping threshold
  sellerId?: string;      // for seller-subsidized shipping lookup
  freeShippingVoucher?: boolean;
}

export interface ShippingResult {
  fee: number;         // VND, 0 if free
  method: ShippingMethod;
  zone: ShippingZone;
  estimatedDays: string;  // e.g. "2-3 ngày"
  isFree: boolean;
  freeShippingReason?: 'VOUCHER' | 'ORDER_THRESHOLD' | 'SELLER_SUBSIDY';
}

// ── Zone Lookup ───────────────────────────────────────────────
// Simplified: major Vietnamese cities grouped by region.
// Production: use official province codes from postal service.
const CITY_REGION: Record<string, string> = {
  'ha noi': 'NORTH',
  'hai phong': 'NORTH',
  'quang ninh': 'NORTH',
  'tp.hcm': 'SOUTH',
  'ho chi minh': 'SOUTH',
  'binh duong': 'SOUTH',
  'dong nai': 'SOUTH',
  'da nang': 'CENTRAL',
  'hue': 'CENTRAL',
  'quy nhon': 'CENTRAL',
  'can tho': 'MEKONG',
  'an giang': 'MEKONG',
};

// ── Rate Tables (VND) ─────────────────────────────────────────
// Base rates by zone × weight tier. Method multiplier applied after.
type WeightTier = '0_500g' | '500g_1kg' | '1kg_5kg' | '5kg_plus';

const BASE_RATES: Record<ShippingZone, Record<WeightTier, number>> = {
  SAME_CITY: {
    '0_500g': 18_000,
    '500g_1kg': 22_000,
    '1kg_5kg': 30_000,
    '5kg_plus': 45_000,
  },
  SAME_REGION: {
    '0_500g': 30_000,
    '500g_1kg': 38_000,
    '1kg_5kg': 55_000,
    '5kg_plus': 80_000,
  },
  CROSS_REGION: {
    '0_500g': 45_000,
    '500g_1kg': 55_000,
    '1kg_5kg': 85_000,
    '5kg_plus': 130_000,
  },
};

const METHOD_MULTIPLIERS: Record<ShippingMethod, number> = {
  STANDARD: 1.0,
  EXPRESS: 1.8,    // 80% surcharge
  SAME_DAY: 3.5,   // 250% surcharge — only available SAME_CITY
};

const ESTIMATED_DAYS: Record<ShippingZone, Record<ShippingMethod, string>> = {
  SAME_CITY: {
    STANDARD: '1-2 ngày',
    EXPRESS: '4-6 giờ',
    SAME_DAY: '2-4 giờ',
  },
  SAME_REGION: {
    STANDARD: '2-3 ngày',
    EXPRESS: '1 ngày',
    SAME_DAY: 'Không hỗ trợ',
  },
  CROSS_REGION: {
    STANDARD: '3-5 ngày',
    EXPRESS: '1-2 ngày',
    SAME_DAY: 'Không hỗ trợ',
  },
};

// Free shipping if order ≥ threshold (VND)
const FREE_SHIPPING_THRESHOLD = 500_000; // 500k VND

@Injectable()
export class ShippingCalculatorService {
  private readonly logger = new Logger(ShippingCalculatorService.name);

  calculate(input: ShippingCalculationInput): ShippingResult {
    const zone = this.resolveZone(input.originCity, input.destinationCity);
    const weightTier = this.resolveWeightTier(input.weightGrams);
    const base = BASE_RATES[zone][weightTier];

    // SAME_DAY only available same city
    const method =
      input.method === 'SAME_DAY' && zone !== 'SAME_CITY' ? 'EXPRESS' : input.method;

    const rawFee = Math.round(base * METHOD_MULTIPLIERS[method]);

    // Check free shipping
    if (input.freeShippingVoucher) {
      return this.freeResult(method, zone, 'VOUCHER');
    }

    if (input.orderTotal >= FREE_SHIPPING_THRESHOLD) {
      return this.freeResult(method, zone, 'ORDER_THRESHOLD');
    }

    return {
      fee: rawFee,
      method,
      zone,
      estimatedDays: ESTIMATED_DAYS[zone][method],
      isFree: false,
    };
  }

  // ── Private ───────────────────────────────────────────────

  private resolveZone(originCity: string, destCity: string): ShippingZone {
    const originNorm = originCity.toLowerCase().trim();
    const destNorm = destCity.toLowerCase().trim();

    if (originNorm === destNorm) return 'SAME_CITY';

    const originRegion = CITY_REGION[originNorm];
    const destRegion = CITY_REGION[destNorm];

    if (originRegion && destRegion && originRegion === destRegion) {
      return 'SAME_REGION';
    }

    return 'CROSS_REGION';
  }

  private resolveWeightTier(weightGrams: number): WeightTier {
    if (weightGrams <= 500) return '0_500g';
    if (weightGrams <= 1000) return '500g_1kg';
    if (weightGrams <= 5000) return '1kg_5kg';
    return '5kg_plus';
  }

  private freeResult(
    method: ShippingMethod,
    zone: ShippingZone,
    reason: 'VOUCHER' | 'ORDER_THRESHOLD' | 'SELLER_SUBSIDY',
  ): ShippingResult {
    return {
      fee: 0,
      method,
      zone,
      estimatedDays: ESTIMATED_DAYS[zone][method],
      isFree: true,
      freeShippingReason: reason,
    };
  }
}
