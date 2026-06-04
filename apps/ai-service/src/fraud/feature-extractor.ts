// apps/ai-service/src/fraud/feature-extractor.ts
// Extracts numerical feature vector from a payment/order event.
// Features are fed into the fraud scoring model.
//
// Feature engineering is critical for fraud detection accuracy.
// Real production systems use 200-500 features; this extracts ~30.

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import { CountMinSketch } from '@hypercommerce/algorithms';

export interface TransactionEvent {
  userId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  ipAddress: string;
  userAgent: string;
  shippingCountry: string;
  billingCountry: string;
  deviceFingerprint?: string;
  emailDomain?: string;
  timestampMs: number;
  itemCount: number;
  isNewAddress: boolean;
}

export interface FraudFeatureVector {
  // Amount features
  normalizedAmount: number; // amount / user's avg order value
  isHighValueTransaction: number; // 1 if > 5M VND
  amountRoundness: number; // is it a suspiciously round number?

  // Velocity features
  orderCountLast1h: number;
  orderCountLast24h: number;
  distinctIpLast24h: number;
  failedPaymentLast7d: number;

  // Geographic features
  isVpnOrProxy: number; // 1 if IP is VPN/data center
  countryMismatch: number; // billing != shipping country
  isHighRiskCountry: number;

  // Behavioral features
  accountAgeHours: number;
  isNewAccount: number; // < 7 days old
  hasVerifiedEmail: number;
  isNewShippingAddress: number;
  itemCountScore: number; // anomaly: ordering 50 items as new user

  // Device features
  isKnownDevice: number;
  suspiciousUserAgent: number;

  // Email features
  isDisposableEmail: number; // mailinator, guerrillamail etc.
  emailRiskScore: number;

  // Time features
  hourOfDay: number; // normalized 0-1
  isWeekend: number;

  // Platform features
  isFirstPurchase: number;
  paymentMethodRisk: number; // stripe=0.1, cod=0.3, etc.
}

const HIGH_RISK_COUNTRIES = new Set([
  'NG',
  'GH',
  'CI',
  'ZA',
  'KE', // African countries with high fraud
  'BY',
  'RU',
  'UA', // Geopolitical risk
  'IR',
  'SY',
  'IQ', // Sanctioned
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwaway.email',
  'yopmail.com',
  '10minutemail.com',
]);

const PAYMENT_METHOD_RISK: Record<string, number> = {
  stripe: 0.1,
  vnpay: 0.15,
  momo: 0.15,
  zalopay: 0.15,
  cod: 0.35, // COD has higher fraud (fake address, return fraud)
  bank_transfer: 0.2,
};

@Injectable()
export class FraudFeatureExtractor {
  private readonly logger = new Logger(FraudFeatureExtractor.name);
  // In-memory frequency tracking (CountMinSketch for memory efficiency)
  private readonly ipOrderCountSketch = new CountMinSketch(2000, 7);

  constructor(private readonly redis: RedisClientService) {}

  async extract(event: TransactionEvent): Promise<FraudFeatureVector> {
    const [
      orderCountLast1h,
      orderCountLast24h,
      distinctIpLast24h,
      failedPaymentLast7d,
      accountData,
    ] = await Promise.all([
      this.getOrderCount(event.userId, '1h'),
      this.getOrderCount(event.userId, '24h'),
      this.getDistinctIpCount(event.userId),
      this.getFailedPaymentCount(event.userId),
      this.getAccountData(event.userId),
    ]);

    const emailDomain = event.emailDomain?.toLowerCase() ?? '';
    const hour = new Date(event.timestampMs).getHours();

    return {
      // Amount
      normalizedAmount: this.normalizeAmount(event.amountCents, accountData.avgOrderValueCents),
      isHighValueTransaction: event.amountCents > 5_000_000 ? 1 : 0,
      amountRoundness: this.isRoundAmount(event.amountCents) ? 1 : 0,

      // Velocity
      orderCountLast1h,
      orderCountLast24h,
      distinctIpLast24h,
      failedPaymentLast7d,

      // Geographic
      isVpnOrProxy: 0, // would call IP intelligence API
      countryMismatch: event.billingCountry !== event.shippingCountry ? 1 : 0,
      isHighRiskCountry: HIGH_RISK_COUNTRIES.has(event.shippingCountry) ? 1 : 0,

      // Behavioral
      accountAgeHours: (event.timestampMs - accountData.createdAtMs) / 3_600_000,
      isNewAccount: accountData.accountAgeHours < 168 ? 1 : 0, // < 7 days
      hasVerifiedEmail: accountData.emailVerified ? 1 : 0,
      isNewShippingAddress: event.isNewAddress ? 1 : 0,
      itemCountScore: this.scoreItemCount(event.itemCount, accountData.accountAgeHours),

      // Device
      isKnownDevice: event.deviceFingerprint
        ? await this.isKnownDevice(event.userId, event.deviceFingerprint)
        : 0,
      suspiciousUserAgent: this.isSuspiciousUserAgent(event.userAgent) ? 1 : 0,

      // Email
      isDisposableEmail: DISPOSABLE_EMAIL_DOMAINS.has(emailDomain) ? 1 : 0,
      emailRiskScore: this.scoreEmailDomain(emailDomain),

      // Time
      hourOfDay: hour / 23,
      isWeekend: [0, 6].includes(new Date(event.timestampMs).getDay()) ? 1 : 0,

      // Platform
      isFirstPurchase: accountData.totalOrders === 0 ? 1 : 0,
      paymentMethodRisk: PAYMENT_METHOD_RISK[event.paymentMethod] ?? 0.3,
    };
  }

  private normalizeAmount(amount: number, avgAmount: number): number {
    if (avgAmount === 0) return 1;
    return Math.min(amount / avgAmount, 10); // cap at 10x
  }

  private isRoundAmount(amountCents: number): boolean {
    const amount = amountCents / 100;
    return amount % 100_000 === 0 || amount % 50_000 === 0;
  }

  private scoreItemCount(itemCount: number, accountAgeHours: number): number {
    // New accounts ordering many items is suspicious
    if (accountAgeHours < 24 && itemCount > 10) return 0.9;
    if (accountAgeHours < 168 && itemCount > 30) return 0.7;
    return 0.1;
  }

  private isSuspiciousUserAgent(ua: string): boolean {
    const lower = ua.toLowerCase();
    return (
      lower.includes('bot') ||
      lower.includes('crawler') ||
      lower.includes('python-requests') ||
      lower.includes('curl') ||
      ua.length < 10
    );
  }

  private scoreEmailDomain(domain: string): number {
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return 0.9;
    if (domain.endsWith('.ru') || domain.endsWith('.xyz')) return 0.5;
    if (['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'].includes(domain)) return 0.1;
    return 0.3; // unknown domain
  }

  private async isKnownDevice(userId: string, fingerprint: string): Promise<number> {
    const key = `fraud:devices:${userId}`;
    const known = await this.redis.sismember(key, fingerprint);
    return known ? 1 : 0;
  }

  private async getOrderCount(_userId: string, _window: string): Promise<number> {
    // Would query Redis sorted set: ZCOUNT user:orders:${userId} (now-window) now
    return 0;
  }

  private async getDistinctIpCount(_userId: string): Promise<number> {
    // Would use HyperLogLog: PFCOUNT user:ips:${userId}
    return 0;
  }

  private async getFailedPaymentCount(_userId: string): Promise<number> {
    return 0;
  }

  private async getAccountData(_userId: string): Promise<{
    avgOrderValueCents: number;
    createdAtMs: number;
    accountAgeHours: number;
    emailVerified: boolean;
    totalOrders: number;
  }> {
    // Would fetch from user-service via gRPC
    return {
      avgOrderValueCents: 500_000,
      createdAtMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
      accountAgeHours: 720,
      emailVerified: true,
      totalOrders: 5,
    };
  }
}
