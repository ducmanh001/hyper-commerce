// ============================================================
// HYPERCOMMERCE — Token Bucket Rate Limiter (in-process)
// AND Sliding Window Counter (distributed via Redis)
//
// Token Bucket:
//   - Allows burst up to bucket capacity
//   - Refills at fixed rate (tokens/second)
//   - Use: per-IP burst protection at NGINX/edge
//
// Sliding Window Counter (Redis):
//   - Exact count in a rolling time window
//   - No "boundary spike" like fixed window
//   - Use: API rate limiting per user/endpoint
//
// Token Bucket maths:
//   capacity = max_burst (e.g., 100 requests)
//   refill_rate = sustained_rpm / 60 (e.g., 1000/60 ≈ 16.7/s)
//   allow = tokens >= cost && (tokens -= cost)
// ============================================================

// ── Token Bucket (in-process) ─────────────────────────────────

export interface TokenBucketOptions {
  /** Max tokens (burst capacity) */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
  /** Cost per request (default 1) */
  costPerRequest?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  tokensRemaining: number;
  retryAfterMs: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;

  constructor(private readonly opts: TokenBucketOptions) {
    this.tokens = opts.capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume tokens — O(1).
   * Thread-safe in single-threaded Node.js event loop.
   */
  consume(cost = this.opts.costPerRequest ?? 1): ConsumeResult {
    this.refill();

    if (this.tokens < cost) {
      // How many ms until we have enough tokens?
      const deficit = cost - this.tokens;
      const retryAfterMs = Math.ceil((deficit / this.opts.refillRate) * 1000);

      return { allowed: false, tokensRemaining: this.tokens, retryAfterMs };
    }

    this.tokens -= cost;
    return { allowed: true, tokensRemaining: this.tokens, retryAfterMs: 0 };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000; // seconds
    const tokensToAdd = elapsed * this.opts.refillRate;

    this.tokens = Math.min(this.opts.capacity, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  get currentTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// ── Token Bucket Pool — one bucket per user/IP ────────────────
// Uses LRU eviction to bound memory at ~1MB per 10K buckets.
export class TokenBucketPool {
  private readonly buckets = new Map<string, { bucket: TokenBucket; lastAccess: number }>();
  private readonly maxBuckets: number;

  constructor(
    private readonly opts: TokenBucketOptions,
    maxBuckets = 10_000,
  ) {
    this.maxBuckets = maxBuckets;
  }

  consume(key: string, cost?: number): ConsumeResult {
    let entry = this.buckets.get(key);

    if (!entry) {
      if (this.buckets.size >= this.maxBuckets) {
        this.evictOldest();
      }
      entry = { bucket: new TokenBucket(this.opts), lastAccess: Date.now() };
      this.buckets.set(key, entry);
    }

    entry.lastAccess = Date.now();
    return entry.bucket.consume(cost);
  }

  private evictOldest(): void {
    let oldest = Infinity;
    let oldestKey = '';

    for (const [key, entry] of this.buckets) {
      if (entry.lastAccess < oldest) {
        oldest = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) this.buckets.delete(oldestKey);
  }

  get bucketCount(): number {
    return this.buckets.size;
  }
}

// ── Sliding Window Rate Limiter (Redis Lua) ───────────────────
// Precise sliding window using sorted sets.
// Key: ratelimit:{userId}:{window}
// Score: timestamp_ms
// Members: unique request IDs

export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requestId = ARGV[4]

-- Remove entries outside the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)

-- Count current window
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = 0
  if oldest and #oldest > 0 then
    retryAfterMs = math.ceil(tonumber(oldest[2]) + windowMs - now)
  end
  return {0, count, retryAfterMs}
end

-- Add this request
redis.call('ZADD', key, now, requestId)
redis.call('PEXPIRE', key, windowMs)

return {1, count + 1, 0}
`;

export interface SlidingWindowResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

// ── Leaky Bucket (for outbound request throttling) ────────────
// Used to throttle calls to external APIs (Stripe, Firebase)
// so we don't exceed their rate limits.
export class LeakyBucket {
  private queue: Array<{ resolve: () => void; timestamp: number }> = [];
  private processing = false;

  constructor(
    /** Max requests per second to external service */
    private readonly ratePerSecond: number,
  ) {}

  /**
   * Acquire a slot — returns a Promise that resolves when
   * the request can proceed.
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve, timestamp: Date.now() });
      if (!this.processing) {
        this.drip();
      }
    });
  }

  private drip(): void {
    this.processing = true;

    const intervalMs = 1000 / this.ratePerSecond;

    const next = () => {
      if (this.queue.length === 0) {
        this.processing = false;
        return;
      }

      const item = this.queue.shift()!;
      item.resolve();
      setTimeout(next, intervalMs);
    };

    next();
  }

  get queueDepth(): number {
    return this.queue.length;
  }
}
