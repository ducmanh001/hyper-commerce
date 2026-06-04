// ============================================================
// HYPERCOMMERCE — Circuit Breaker
//
// WHY CIRCUIT BREAKER?
// Without it: one slow/failing downstream (Stripe, VNPay, GHN)
// causes thread pool exhaustion as requests pile up waiting.
// With it: fast-fail after N failures → shed load → allow recovery.
//
// STATES:
// CLOSED   → Normal operation. Requests pass through.
// OPEN     → Failing fast. No requests allowed. Timer runs.
// HALF_OPEN→ Trial mode after timeout. 1 request passes per tick.
//            If succeeds → CLOSED. If fails → back to OPEN.
//
// WHY REDIS FOR STATE?
// Services are horizontally scaled (multiple pods). A per-process
// circuit breaker would trip independently on each pod — inconsistent.
// Redis-shared state means: one pod detects failure, ALL pods trip.
// Consistent behavior under distributed deployment.
//
// ALTERNATIVES CONSIDERED:
// - Resilience4j (Java): not available in Node
// - Opossum: popular but stores state in-process (not distributed)
// - Custom Redis: chosen for distributed consistency
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Name used in Redis keys and metrics */
  name: string;
  /** Consecutive failures before opening */
  failureThreshold?: number;
  /** Consecutive successes in HALF_OPEN before closing */
  successThreshold?: number;
  /** How long to stay OPEN before trying HALF_OPEN (ms) */
  openTimeoutMs?: number;
}

export interface CircuitCallResult<T> {
  result?: T;
  state: CircuitState;
  circuitTripped: boolean;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  private readonly FAILURE_THRESHOLD: number;
  private readonly SUCCESS_THRESHOLD: number;
  private readonly OPEN_TIMEOUT_MS: number;

  constructor(private readonly redis: RedisClientService) {
    this.FAILURE_THRESHOLD = APP_CONSTANTS.CIRCUIT_BREAKER.FAILURE_THRESHOLD;
    this.SUCCESS_THRESHOLD = APP_CONSTANTS.CIRCUIT_BREAKER.SUCCESS_THRESHOLD;
    this.OPEN_TIMEOUT_MS = APP_CONSTANTS.CIRCUIT_BREAKER.OPEN_TIMEOUT;
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * Usage:
   * ```ts
   * const { result } = await circuitBreaker.call('stripe', () => stripe.charge(...));
   * ```
   *
   * @throws CircuitOpenError if circuit is OPEN
   * @throws original error if circuit is CLOSED/HALF_OPEN and call fails
   */
  async call<T>(
    name: string,
    fn: () => Promise<T>,
    options?: Partial<CircuitBreakerOptions>,
  ): Promise<CircuitCallResult<T>> {
    const opts = this.mergeOptions(name, options);
    const state = await this.getState(opts.name);

    // OPEN → fast-fail
    if (state === 'OPEN') {
      // Check if timeout elapsed → transition to HALF_OPEN
      const shouldRetry = await this.shouldAttemptHalfOpen(opts.name);
      if (!shouldRetry) {
        this.logger.warn(`Circuit OPEN for ${opts.name} — fast failing`);
        return { state: 'OPEN', circuitTripped: true };
      }
      // Transition to HALF_OPEN and allow one request
      await this.setState(opts.name, 'HALF_OPEN');
    }

    // CLOSED or HALF_OPEN → try the call
    try {
      const result = await fn();
      await this.onSuccess(opts);
      return { result, state: 'CLOSED', circuitTripped: false };
    } catch (err) {
      await this.onFailure(opts);
      throw err;
    }
  }

  async getState(name: string): Promise<CircuitState> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:state`;
    const state = await this.redis.get(key);
    return (state as CircuitState | null) ?? 'CLOSED';
  }

  async isOpen(name: string): Promise<boolean> {
    return (await this.getState(name)) === 'OPEN';
  }

  async reset(name: string): Promise<void> {
    const client = this.redis.getClient();
    const pipeline = client.pipeline();
    pipeline.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:state`);
    pipeline.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:failures`);
    pipeline.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:successes`);
    pipeline.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:opened_at`);
    await pipeline.exec();
    this.logger.log(`Circuit reset: ${name}`);
  }

  // ── Private ───────────────────────────────────────────────

  private async onSuccess(opts: Required<CircuitBreakerOptions>): Promise<void> {
    const state = await this.getState(opts.name);

    if (state === 'HALF_OPEN') {
      const successKey = `${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${opts.name}:successes`;
      const successes = await this.redis.getClient().incr(successKey);

      if (successes >= opts.successThreshold) {
        await this.setState(opts.name, 'CLOSED');
        await this.clearCounters(opts.name);
        this.logger.log(`Circuit CLOSED: ${opts.name} (recovered)`);
      }
    } else if (state === 'CLOSED') {
      // Reset failure counter on success
      await this.redis.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${opts.name}:failures`);
    }
  }

  private async onFailure(opts: Required<CircuitBreakerOptions>): Promise<void> {
    const failureKey = `${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${opts.name}:failures`;
    const failures = await this.redis.getClient().incr(failureKey);
    // TTL auto-cleanup after 2× open timeout
    await this.redis.getClient().expire(failureKey, Math.ceil((opts.openTimeoutMs * 2) / 1000));

    this.logger.warn(
      JSON.stringify({
        event: 'circuit_failure',
        name: opts.name,
        failures,
        threshold: opts.failureThreshold,
      }),
    );

    if (failures >= opts.failureThreshold) {
      await this.setState(opts.name, 'OPEN');
      await this.redis.set(
        `${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${opts.name}:opened_at`,
        String(Date.now()),
        Math.ceil((opts.openTimeoutMs * 3) / 1000),
      );
      this.logger.error(`Circuit OPEN: ${opts.name} (${failures} consecutive failures)`);
    }
  }

  private async shouldAttemptHalfOpen(name: string): Promise<boolean> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:opened_at`;
    const openedAt = await this.redis.get(key);
    if (!openedAt) return true; // no timestamp → allow

    const elapsed = Date.now() - parseInt(openedAt, 10);
    return elapsed >= this.OPEN_TIMEOUT_MS;
  }

  private async setState(name: string, state: CircuitState): Promise<void> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:state`;
    await this.redis.set(key, state, 3600); // 1 hour max TTL
  }

  private async clearCounters(name: string): Promise<void> {
    const client = this.redis.getClient();
    const pipeline = client.pipeline();
    pipeline.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:failures`);
    pipeline.del(`${APP_CONSTANTS.REDIS_KEYS.CIRCUIT_BREAKER}${name}:successes`);
    await pipeline.exec();
  }

  private mergeOptions(
    name: string,
    opts?: Partial<CircuitBreakerOptions>,
  ): Required<CircuitBreakerOptions> {
    return {
      name,
      failureThreshold: opts?.failureThreshold ?? this.FAILURE_THRESHOLD,
      successThreshold: opts?.successThreshold ?? this.SUCCESS_THRESHOLD,
      openTimeoutMs: opts?.openTimeoutMs ?? this.OPEN_TIMEOUT_MS,
    };
  }
}
