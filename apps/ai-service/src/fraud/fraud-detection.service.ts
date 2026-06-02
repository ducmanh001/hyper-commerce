// ============================================================
// HYPERCOMMERCE — Fraud Detection Service
// Rule-based + ML scoring hybrid approach.
// Real-time decision: ALLOW / CHALLENGE (OTP) / BLOCK.
//
// Signal types:
// 1. Velocity: orders/minute, payment attempts
// 2. Behavioral: device fingerprint, typing patterns
// 3. Network: IP reputation, VPN/proxy detection
// 4. Identity: email/phone age, account age
// 5. Graph: connected accounts (shared device/payment)
// 6. ML: isolation forest for anomaly detection
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RedisClientService } from '@hypercommerce/redis';

export type FraudDecision = 'ALLOW' | 'CHALLENGE' | 'BLOCK';

export interface FraudSignals {
  userId: string;
  orderId?: string;
  amount: number;
  currency: string;
  paymentMethodType: string;
  deviceId?: string;
  ipAddress: string;
  userAgent: string;
  billingCountry?: string;
  shippingCountry?: string;
  emailDomain?: string;
  accountAgeDays: number;
  sessionId: string;
}

export interface FraudAssessment {
  decision: FraudDecision;
  score: number;           // 0.0 - 1.0 (higher = riskier)
  riskFactors: string[];
  challengeType?: 'OTP_SMS' | 'OTP_EMAIL' | 'CAPTCHA' | '3DS';
  blockedReason?: string;
  processingMs: number;
}

interface VelocityResult {
  orderCount1h: number;
  orderCount24h: number;
  paymentAttempts1h: number;
  uniqueCards24h: number;
}

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  // Thresholds — tuned per business risk tolerance
  private readonly THRESHOLDS = {
    BLOCK_SCORE: 0.85,
    CHALLENGE_SCORE: 0.55,
    VELOCITY_ORDERS_1H: 5,
    VELOCITY_ORDERS_24H: 20,
    VELOCITY_PAYMENT_ATTEMPTS_1H: 10,
    HIGH_VALUE_THRESHOLD_USD: 500,
    YOUNG_ACCOUNT_DAYS: 7,
  } as const;

  // IP reputation API
  private readonly IP_REPUTATION_URL = 'https://api.ipqualityscore.com/api/json/ip';

  constructor(
    private readonly redis: RedisClientService,
    private readonly http: HttpService,
  ) {}

  /**
   * Assess fraud risk for a transaction.
   * Target SLA: < 50ms (inline in order creation flow).
   *
   * Critical: must be non-blocking — worst case accept risk
   * rather than blocking user on timeout.
   */
  async assess(signals: FraudSignals): Promise<FraudAssessment> {
    const startMs = Date.now();
    const riskFactors: string[] = [];
    let score = 0.0;

    // Run checks in parallel — all non-blocking with timeouts
    const [velocity, ipRep, mlScore] = await Promise.allSettled([
      this.checkVelocity(signals.userId, signals.ipAddress),
      this.checkIpReputation(signals.ipAddress),
      this.getMlScore(signals),
    ]);

    // ── Velocity checks ───────────────────────────────────
    if (velocity.status === 'fulfilled') {
      const v = velocity.value;
      if (v.orderCount1h > this.THRESHOLDS.VELOCITY_ORDERS_1H) {
        score += 0.3;
        riskFactors.push(`HIGH_ORDER_VELOCITY_1H:${v.orderCount1h}`);
      }
      if (v.orderCount24h > this.THRESHOLDS.VELOCITY_ORDERS_24H) {
        score += 0.2;
        riskFactors.push(`HIGH_ORDER_VELOCITY_24H:${v.orderCount24h}`);
      }
      if (v.paymentAttempts1h > this.THRESHOLDS.VELOCITY_PAYMENT_ATTEMPTS_1H) {
        score += 0.4;
        riskFactors.push(`HIGH_PAYMENT_ATTEMPTS:${v.paymentAttempts1h}`);
      }
      if (v.uniqueCards24h > 3) {
        score += 0.25;
        riskFactors.push(`MULTIPLE_CARDS:${v.uniqueCards24h}`);
      }
    }

    // ── IP reputation ─────────────────────────────────────
    if (ipRep.status === 'fulfilled') {
      const ip = ipRep.value;
      if (ip.isVpn || ip.isTor) {
        score += 0.2;
        riskFactors.push('VPN_OR_TOR');
      }
      if (ip.fraudScore > 75) {
        score += 0.3;
        riskFactors.push(`HIGH_IP_FRAUD_SCORE:${ip.fraudScore}`);
      }
      if (ip.countryCode !== signals.billingCountry) {
        score += 0.1;
        riskFactors.push('IP_BILLING_COUNTRY_MISMATCH');
      }
    }

    // ── ML anomaly score ──────────────────────────────────
    if (mlScore.status === 'fulfilled') {
      const mlVal = mlScore.value;
      score = Math.max(score, score * 0.5 + mlVal * 0.5); // Blend rule + ML
      if (mlVal > 0.7) {
        riskFactors.push(`ML_ANOMALY:${mlVal.toFixed(2)}`);
      }
    }

    // ── Account-level signals ─────────────────────────────
    if (signals.accountAgeDays < this.THRESHOLDS.YOUNG_ACCOUNT_DAYS) {
      score += 0.15;
      riskFactors.push(`YOUNG_ACCOUNT:${signals.accountAgeDays}d`);
    }

    // High value order with young account → higher risk
    if (
      signals.amount > this.THRESHOLDS.HIGH_VALUE_THRESHOLD_USD * 100 && // amount in cents
      signals.accountAgeDays < 30
    ) {
      score += 0.2;
      riskFactors.push('HIGH_VALUE_YOUNG_ACCOUNT');
    }

    // Cross-border shipment
    if (signals.billingCountry !== signals.shippingCountry) {
      score += 0.1;
      riskFactors.push('CROSS_BORDER');
    }

    // Clamp score
    score = Math.min(1.0, score);

    // ── Decision ──────────────────────────────────────────
    let decision: FraudDecision;
    let challengeType: FraudAssessment['challengeType'];
    let blockedReason: string | undefined;

    if (score >= this.THRESHOLDS.BLOCK_SCORE) {
      decision = 'BLOCK';
      blockedReason = riskFactors[0] ?? 'HIGH_RISK_SCORE';
      // Log to fraud review queue
      await this.flagForReview(signals, score, riskFactors);
    } else if (score >= this.THRESHOLDS.CHALLENGE_SCORE) {
      decision = 'CHALLENGE';
      // Higher risk → stronger challenge
      challengeType = score > 0.75 ? '3DS' : 'OTP_SMS';
    } else {
      decision = 'ALLOW';
    }

    const assessment: FraudAssessment = {
      decision,
      score,
      riskFactors,
      challengeType,
      blockedReason,
      processingMs: Date.now() - startMs,
    };

    this.logger.log(
      JSON.stringify({
        event: 'fraud_assessment',
        userId: signals.userId,
        decision,
        score: score.toFixed(3),
        riskFactors,
        processingMs: assessment.processingMs,
      }),
    );

    return assessment;
  }

  // ── Private helpers ───────────────────────────────────────

  private async checkVelocity(
    userId: string,
    ipAddress: string,
  ): Promise<VelocityResult> {
    const now = Date.now();
    const key1h = `fraud:vel:1h:${userId}`;
    const key24h = `fraud:vel:24h:${userId}`;
    const keyIp1h = `fraud:vel:ip:1h:${ipAddress}`;
    const keyCards24h = `fraud:vel:cards:24h:${userId}`;

    const pipeline = (this.redis.getClient() as import('ioredis').Redis).pipeline();
    pipeline.get(key1h);
    pipeline.get(key24h);
    pipeline.get(keyIp1h);
    pipeline.get(keyCards24h);
    const results = await pipeline.exec();

    return {
      orderCount1h: Number((results?.[0]?.[1] as string) ?? '0'),
      orderCount24h: Number((results?.[1]?.[1] as string) ?? '0'),
      paymentAttempts1h: Number((results?.[2]?.[1] as string) ?? '0'),
      uniqueCards24h: Number((results?.[3]?.[1] as string) ?? '0'),
    };
  }

  /**
   * Increment velocity counters on each order attempt.
   * Call this AFTER fraud assessment (not before — creates race).
   */
  async recordAttempt(userId: string, ipAddress: string): Promise<void> {
    const pipeline = (this.redis.getClient() as import('ioredis').Redis).pipeline();

    const key1h = `fraud:vel:1h:${userId}`;
    const key24h = `fraud:vel:24h:${userId}`;
    const keyIp1h = `fraud:vel:ip:1h:${ipAddress}`;

    pipeline.incr(key1h);
    pipeline.expire(key1h, 3600);
    pipeline.incr(key24h);
    pipeline.expire(key24h, 86400);
    pipeline.incr(keyIp1h);
    pipeline.expire(keyIp1h, 3600);

    await pipeline.exec();
  }

  private async checkIpReputation(
    ipAddress: string,
  ): Promise<{ isVpn: boolean; isTor: boolean; fraudScore: number; countryCode: string }> {
    const cacheKey = `fraud:ip:${ipAddress}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as { isVpn: boolean; isTor: boolean; fraudScore: number; countryCode: string };

    try {
      const response = await firstValueFrom(
        this.http.get<{
          vpn: boolean;
          tor: boolean;
          fraud_score: number;
          country_code: string;
        }>(
          `${this.IP_REPUTATION_URL}/${ipAddress}?key=${process.env.IP_QUALITY_SCORE_API_KEY}`,
          { timeout: 1000 }, // 1s timeout — skip if slow
        ),
      );

      const data = {
        isVpn: response.data.vpn,
        isTor: response.data.tor,
        fraudScore: response.data.fraud_score,
        countryCode: response.data.country_code,
      };

      // Cache IP reputation for 1 hour
      await this.redis.set(cacheKey, JSON.stringify(data), 3600);
      return data;
    } catch {
      // Default safe value on timeout
      return { isVpn: false, isTor: false, fraudScore: 0, countryCode: 'UNKNOWN' };
    }
  }

  /**
   * ML anomaly score — Isolation Forest or gradient boosting model.
   * Served by ML inference server (TensorFlow Serving / BentoML).
   */
  private async getMlScore(signals: FraudSignals): Promise<number> {
    const mlHost = process.env.ML_INFERENCE_HOST;
    if (!mlHost) return 0;

    try {
      const response = await firstValueFrom(
        this.http.post<{ fraud_score: number }>(
          `${mlHost}/v1/models/fraud:predict`,
          {
            instances: [{
              user_age_days: signals.accountAgeDays,
              amount_usd: signals.amount / 100,
              device_id_hash: this.hashString(signals.deviceId ?? ''),
              ip_hash: this.hashString(signals.ipAddress),
              cross_border: signals.billingCountry !== signals.shippingCountry ? 1 : 0,
            }],
          },
          { timeout: 30 }, // 30ms hard timeout — must not block payment
        ),
      );

      return response.data.fraud_score;
    } catch {
      return 0;
    }
  }

  private async flagForReview(
    signals: FraudSignals,
    score: number,
    riskFactors: string[],
  ): Promise<void> {
    const reviewKey = 'fraud:review:queue';
    const payload = JSON.stringify({
      userId: signals.userId,
      orderId: signals.orderId,
      score,
      riskFactors,
      flaggedAt: new Date().toISOString(),
    });

    await (this.redis.getClient() as import('ioredis').Redis).lpush(reviewKey, payload);
    // Trim queue to 10K items to prevent unbounded growth
    await (this.redis.getClient() as import('ioredis').Redis).ltrim(reviewKey, 0, 9999);
  }

  private hashString(input: string): number {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    return Math.abs(hash) % 1_000_000;
  }
}
