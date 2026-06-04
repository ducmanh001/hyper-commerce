// ============================================================
// HYPERCOMMERCE — Fraud Agent Service
//
// Three-layer fraud detection:
//   Layer 1: Hard rules (synchronous, <1ms)
//   Layer 2: ML scoring (LightGBM features, <10ms)
//   Layer 3: Graph analysis (async, post-order)
//
// Called by order-service BEFORE confirming any order.
// Result: PASS | REVIEW | BLOCK
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { AgentTask, AgentResult, FraudTaskInput, FraudTaskOutput } from '../types';
import { AgentType, TaskStatus } from '../types';
import type { RedisMemoryService } from '../memory/redis-memory.service';
import type { EpisodicMemoryService } from '../memory/episodic-memory.service';

@Injectable()
export class FraudAgentService {
  private readonly logger = new Logger(FraudAgentService.name);

  // Thresholds
  private readonly VELOCITY_ORDERS_HOUR = 10;
  private readonly VELOCITY_ORDERS_DAY = 30;
  private readonly MAX_FAILED_PAYMENTS_DAY = 3;
  private readonly MAX_DEVICES_WEEK = 5;
  private readonly HIGH_RISK_AMOUNT_VND = 50_000_000; // 50M VND
  private readonly ML_BLOCK_THRESHOLD = 0.7;
  private readonly ML_REVIEW_THRESHOLD = 0.4;

  constructor(
    private readonly memory: RedisMemoryService,
    private readonly episodic: EpisodicMemoryService,
  ) {}

  async evaluate(task: AgentTask<FraudTaskInput>): Promise<AgentResult<FraudTaskOutput>> {
    const start = Date.now();
    const { input } = task;

    try {
      // Early exit: known blocked user
      if (await this.memory.isFraudBlocked(input.userId)) {
        return this.buildResult(task, start, {
          decision: 'BLOCK',
          score: 1.0,
          reasons: ['User is on fraud block list'],
          rulesFired: ['BLOCK_LIST'],
        });
      }

      // Layer 1: Hard rules
      const { rulesFired, hardDecision } = await this.runHardRules(input);

      if (hardDecision === 'BLOCK') {
        await this.memory.setFraudScore(input.userId, 0.95);
        return this.buildResult(task, start, {
          decision: 'BLOCK',
          score: 0.95,
          reasons: rulesFired.map((r) => this.ruleDescription(r)),
          rulesFired,
        });
      }

      // Layer 2: ML-style feature scoring
      const mlScore = this.computeMLScore(input);

      // Merge: rules fired increase score
      const finalScore = Math.min(mlScore + rulesFired.length * 0.1, 1.0);

      let decision: FraudTaskOutput['decision'];
      if (finalScore >= this.ML_BLOCK_THRESHOLD) {
        decision = 'BLOCK';
        await this.memory.blockUser(input.userId, `Fraud score ${finalScore.toFixed(2)}`);
      } else if (finalScore >= this.ML_REVIEW_THRESHOLD || rulesFired.length > 0) {
        decision = 'REVIEW';
      } else {
        decision = 'PASS';
      }

      await this.memory.setFraudScore(input.userId, finalScore);

      return this.buildResult(task, start, {
        decision,
        score: finalScore,
        mlScore,
        reasons: rulesFired.map((r) => this.ruleDescription(r)),
        rulesFired,
      });
    } catch (err) {
      this.logger.error('Fraud evaluation error', err);
      // Fail open — don't block legitimate orders due to system error
      return this.buildResult(
        task,
        start,
        {
          decision: 'PASS',
          score: 0,
          reasons: ['Evaluation error — defaulting to PASS'],
          rulesFired: [],
        },
        TaskStatus.FAILED,
      );
    }
  }

  // ── Layer 1: Hard Rules ─────────────────────────────────────

  private async runHardRules(
    input: FraudTaskInput,
  ): Promise<{ rulesFired: string[]; hardDecision: 'PASS' | 'BLOCK' }> {
    const rules: string[] = [];

    // Rule: Impossible geography (billing vs shipping city)
    if (this.isImpossibleLocation(input.ipAddress, input.billingCity)) {
      rules.push('IMPOSSIBLE_GEO');
    }

    // Rule: High-value order (>50M VND) — requires extra scrutiny
    if (input.amount > this.HIGH_RISK_AMOUNT_VND) {
      rules.push('HIGH_VALUE_ORDER');
    }

    // Rule: Mass buying (same product, qty > 20 suggests reseller/abuse)
    const singleItemQty = Math.max(...input.items.map((i) => i.quantity));
    if (singleItemQty > 20) {
      rules.push('BULK_PURCHASE');
    }

    // Rule: Empty device fingerprint (bot indicator)
    if (!input.deviceFingerprint || input.deviceFingerprint === 'unknown') {
      rules.push('MISSING_DEVICE_FP');
    }

    // Hard block: multiple hard signals together
    const hardBlockRules = ['IMPOSSIBLE_GEO', 'MISSING_DEVICE_FP'];
    const hardBlocked = rules.filter((r) => hardBlockRules.includes(r)).length >= 2;

    return {
      rulesFired: rules,
      hardDecision: hardBlocked ? 'BLOCK' : 'PASS',
    };
  }

  // ── Layer 2: ML Feature Scoring ─────────────────────────────

  /**
   * Approximates LightGBM feature scoring.
   * In production, this would call a deployed ONNX/TF Serving model.
   * Features are heuristically weighted for v1.
   */
  private computeMLScore(input: FraudTaskInput): number {
    let score = 0.0;

    // High order amount relative to VN average order (~800K VND)
    const amountNormalized = Math.min(input.amount / 50_000_000, 1.0);
    score += amountNormalized * 0.25;

    // COD on high-value order (often fraud vector in VN market)
    if (input.paymentMethod === 'COD' && input.amount > 5_000_000) {
      score += 0.2;
    }

    // Many different product categories (bot-like exploration)
    const uniqueCategories = new Set(input.items.map((i) => i.productId.slice(0, 8))).size;
    if (uniqueCategories > 5) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  // ── Helpers ────────────────────────────────────────────────

  private isImpossibleLocation(ipAddress: string, billingCity: string): boolean {
    // Simplified: flag if IP is a known VPN/proxy (in prod: MaxMind GeoIP)
    const knownVpnPrefixes = ['10.', '172.16.', '192.168.'];
    // Private IPs in production context = suspicious
    return knownVpnPrefixes.some((p) => ipAddress.startsWith(p)) && !!billingCity;
  }

  private ruleDescription(rule: string): string {
    const descriptions: Record<string, string> = {
      IMPOSSIBLE_GEO: 'IP location does not match billing address',
      HIGH_VALUE_ORDER: 'Order value exceeds high-risk threshold (50M VND)',
      BULK_PURCHASE: 'Bulk purchase of single item (potential abuse)',
      MISSING_DEVICE_FP: 'No device fingerprint (potential bot)',
      BLOCK_LIST: 'User is on fraud block list',
    };
    return descriptions[rule] ?? rule;
  }

  private buildResult(
    task: AgentTask<FraudTaskInput>,
    startMs: number,
    output: FraudTaskOutput,
    status = TaskStatus.COMPLETED,
  ): AgentResult<FraudTaskOutput> {
    return {
      taskId: task.taskId,
      type: AgentType.FRAUD,
      status,
      output,
      toolCallsCount: 2,
      durationMs: Date.now() - startMs,
      completedAt: new Date().toISOString(),
    };
  }
}
