// ============================================================
// HYPERCOMMERCE — Retry Utility
// Exponential backoff with jitter — dùng cho external calls,
// DB connection, và Kafka produce retries.
// ============================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor?: number;        // default 2 (exponential)
  jitter?: boolean;       // default true (full jitter)
  retryIf?: (error: unknown) => boolean; // default: always retry
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTS: Required<Omit<RetryOptions, 'onRetry' | 'retryIf'>> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5_000,
  factor: 2,
  jitter: true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTS, ...options };

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If retry condition defined and not met — rethrow immediately
      if (opts.retryIf && !opts.retryIf(error)) {
        throw error;
      }

      if (attempt === opts.maxAttempts) break;

      const delay = computeDelay(attempt, opts);
      opts.onRetry?.(error, attempt, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

function computeDelay(
  attempt: number,
  opts: Required<Omit<RetryOptions, 'onRetry' | 'retryIf'>>,
): number {
  // Exponential: baseDelay * factor^(attempt-1)
  const exp = opts.baseDelayMs * Math.pow(opts.factor, attempt - 1);
  const capped = Math.min(exp, opts.maxDelayMs);

  if (!opts.jitter) return capped;

  // Full jitter: random in [0, cap] — prevents thundering herd
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Circuit Breaker ──────────────────────────────────────────
// Simple in-process circuit breaker — for distributed use Redis-based
export enum CircuitState {
  CLOSED = 'CLOSED',   // Normal operation
  OPEN = 'OPEN',       // Failing — reject all calls
  HALF_OPEN = 'HALF_OPEN', // Testing if recovered
}

export class CircuitBreaker<T = unknown> {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly options: {
      failureThreshold: number;  // consecutive failures to open
      successThreshold: number;  // successes in half-open to close
      openTimeoutMs: number;     // time before trying half-open
    },
  ) {}

  async execute(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.options.openTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error(
          `Circuit breaker '${this.name}' is OPEN — rejecting call`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
