// apps/ai-service/src/fraud/fraud-scorer.ts
// Scores a transaction for fraud probability using gradient boosting model.
//
// Model: LightGBM (served via ONNX Runtime) or rule-based fallback.
// Threshold: >= 0.8 → reject, >= 0.5 → require 3DS, < 0.3 → allow.
//
// Feature importance (from offline training):
// 1. orderCountLast1h (velocity)
// 2. normalizedAmount (anomaly)
// 3. accountAgeHours (new account risk)
// 4. distinctIpLast24h (device hopping)
// 5. countryMismatch (geographic anomaly)

import { Injectable, Logger } from '@nestjs/common';
import type { FraudFeatureVector } from './feature-extractor';
import { FRAUD_THRESHOLDS } from '../constants/ai.constants';

export interface FraudScore {
  score: number; // 0-1 (1 = definitely fraud)
  risk: 'low' | 'medium' | 'high';
  recommendation: 'allow' | 'review' | 'block' | 'require_3ds';
  topFeatures: Array<{ feature: string; contribution: number }>;
  modelVersion: string;
}

@Injectable()
export class FraudScorer {
  private readonly logger = new Logger(FraudScorer.name);

  /**
   * Score a feature vector for fraud probability.
   *
   * In production, this calls ONNX Runtime or a remote model server.
   * This implementation uses a rule-based linear model as a fallback
   * when the ML model is unavailable.
   *
   * Feature weights derived from offline LightGBM SHAP values:
   */
  score(features: FraudFeatureVector): FraudScore {
    // Linear model: weighted sum of features (approximates tree model)
    const WEIGHTS: Partial<Record<keyof FraudFeatureVector, number>> = {
      orderCountLast1h: 0.25,
      normalizedAmount: 0.15,
      accountAgeHours: -0.1, // older account = lower risk
      distinctIpLast24h: 0.12,
      countryMismatch: 0.1,
      isHighRiskCountry: 0.08,
      failedPaymentLast7d: 0.07,
      isNewAccount: 0.06,
      isDisposableEmail: 0.05,
      suspiciousUserAgent: 0.05,
      isNewShippingAddress: 0.03,
      paymentMethodRisk: 0.04,
    };

    let rawScore = 0;
    const contributions: Array<{ feature: string; contribution: number }> = [];

    for (const [feature, weight] of Object.entries(WEIGHTS)) {
      const value = features[feature as keyof FraudFeatureVector] as number;
      const normalized = this.normalizeFeature(feature, value);
      const contribution = weight * normalized;
      rawScore += contribution;

      if (Math.abs(contribution) > 0.02) {
        contributions.push({ feature, contribution });
      }
    }

    // Sigmoid activation: score in [0, 1]
    const score = 1 / (1 + Math.exp(-rawScore * 5));

    const risk = this.classifyRisk(score);
    const recommendation = this.getRecommendation(score);

    // Sort by absolute contribution (most impactful first)
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score: Math.round(score * 1000) / 1000,
      risk,
      recommendation,
      topFeatures: contributions.slice(0, 5),
      modelVersion: 'rule-based-v1',
    };
  }

  private normalizeFeature(feature: string, value: number): number {
    // Normalize some features to [0, 1] range
    switch (feature) {
      case 'orderCountLast1h':
        return Math.min(value / 10, 1);
      case 'orderCountLast24h':
        return Math.min(value / 50, 1);
      case 'distinctIpLast24h':
        return Math.min(value / 5, 1);
      case 'accountAgeHours':
        return Math.min(value / (30 * 24), 1);
      case 'failedPaymentLast7d':
        return Math.min(value / 5, 1);
      default:
        return Math.max(0, Math.min(1, value));
    }
  }

  private classifyRisk(score: number): 'low' | 'medium' | 'high' {
    if (score >= FRAUD_THRESHOLDS.HIGH_RISK) return 'high';
    if (score >= FRAUD_THRESHOLDS.MEDIUM_RISK) return 'medium';
    return 'low';
  }

  private getRecommendation(score: number): 'allow' | 'review' | 'block' | 'require_3ds' {
    if (score >= FRAUD_THRESHOLDS.HIGH_RISK) return 'block';
    if (score >= FRAUD_THRESHOLDS.MEDIUM_RISK) return 'require_3ds';
    if (score >= FRAUD_THRESHOLDS.LOW_RISK) return 'review';
    return 'allow';
  }
}
