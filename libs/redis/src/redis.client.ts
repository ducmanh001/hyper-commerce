// ============================================================
// HYPERCOMMERCE — Redis Client
// Cluster-aware client với atomic Lua scripts cho inventory ops
// ============================================================

import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Redis, { Cluster } from 'ioredis';

// ── Lua Scripts (loaded once, executed atomically on Redis) ───
// KEYS[1] = stock key, ARGV[1] = amount to decrement
const LUA_ATOMIC_DECREMENT = `
local current = redis.call('GET', KEYS[1])
if current == false then
  return {-2, 0}  -- key does not exist
end
local stock = tonumber(current)
local amount = tonumber(ARGV[1])
if stock < amount then
  return {-1, stock}  -- insufficient stock
end
local newStock = redis.call('DECRBY', KEYS[1], amount)
return {0, newStock}  -- success, return new stock
`;

// KEYS[1] = stock key, KEYS[2] = reservation key
// ARGV[1] = amount, ARGV[2] = TTL seconds
const LUA_RESERVE_STOCK = `
local current = redis.call('GET', KEYS[1])
if current == false then return {-2, 0} end
local stock = tonumber(current)
local amount = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if stock < amount then return {-1, stock} end
redis.call('DECRBY', KEYS[1], amount)
redis.call('SETEX', KEYS[2], ttl, amount)
return {0, stock - amount}
`;

// KEYS[1] = stock key, KEYS[2] = reservation key
const LUA_RELEASE_RESERVATION = `
local reserved = redis.call('GET', KEYS[2])
if reserved == false then return 0 end
redis.call('INCRBY', KEYS[1], reserved)
redis.call('DEL', KEYS[2])
return tonumber(reserved)
`;

// Flash sale dequeue — KEYS[1] = queue key, ARGV[1] = batch size
const LUA_FLASH_SALE_DEQUEUE = `
local batch = {}
local size = tonumber(ARGV[1])
for i = 1, size do
  local item = redis.call('RPOP', KEYS[1])
  if item == false then break end
  table.insert(batch, item)
end
return batch
`;

export interface StockOperationResult {
  success: boolean;
  newStock: number;
  error?: 'NOT_FOUND' | 'INSUFFICIENT';
}

@Injectable()
export class RedisClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientService.name);
  private client!: Redis | Cluster;

  // Cached script SHAs — loaded on startup for low-latency EVALSHA
  private scriptShas: Record<string, string> = {};

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const isCluster = this.config.get<string>('REDIS_CLUSTER_NODES');

    if (isCluster) {
      const nodes = isCluster.split(',').map((addr: string) => {
        const [host, port] = addr.split(':');
        return { host, port: Number(port) };
      });

      this.client = new Cluster(nodes, {
        clusterRetryStrategy: (times: number) => Math.min(times * 100, 3_000),
        redisOptions: {
          password: this.config.get('REDIS_PASSWORD') || undefined,
          tls: this.config.get('REDIS_TLS') === 'true' ? {} : undefined,
        },
      });
    } else {
      this.client = new Redis({
        host: this.config.get('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        password: this.config.get('REDIS_PASSWORD') || undefined,
        db: this.config.get<number>('REDIS_DB', 0),
        retryStrategy: (times: number) => Math.min(times * 100, 3_000),
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
      });
    }

    this.client.on('error', (err: Error) => this.logger.error(`Redis error: ${err.message}`));

    this.client.on('ready', () => this.logger.log('Redis connected'));

    // Load all Lua scripts and cache SHAs
    await this.loadScripts();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis disconnected');
  }

  // ── Raw client access ─────────────────────────────────────
  getClient(): Redis | Cluster {
    return this.client;
  }

  // ── Generic ops ───────────────────────────────────────────
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  /** Store a Buffer (binary data) — used for BloomFilter/HLL serialization */
  async setBuffer(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await (this.client as Redis).set(key, value, 'EX', ttlSeconds);
    } else {
      await (this.client as Redis).set(key, value);
    }
  }

  /** Retrieve a Buffer (binary data) */
  async getBuffer(key: string): Promise<Buffer | null> {
    return (this.client as Redis).getBuffer(key);
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async exists(...keys: string[]): Promise<number> {
    return this.client.exists(...keys);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrby(key: string, by: number): Promise<number> {
    return this.client.incrby(key, by);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  /** Increment the score of a sorted set member — creates if not exists */
  async zincrby(key: string, increment: number, member: string): Promise<string> {
    return this.client.zincrby(key, increment, member);
  }

  /** Get top members from sorted set in descending score order, with scores */
  async zrevrangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<Array<{ value: string; score: number }>> {
    const raw = await this.client.zrevrange(key, start, stop, 'WITHSCORES');
    const result: Array<{ value: string; score: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ value: raw[i], score: parseFloat(raw[i + 1]) });
    }
    return result;
  }

  async zrangebyscore(
    key: string,
    min: number | '-inf',
    max: number | '+inf',
    options?: { limit?: { offset: number; count: number } },
  ): Promise<string[]> {
    if (options?.limit) {
      return this.client.zrangebyscore(
        key,
        min,
        max,
        'LIMIT',
        options.limit.offset,
        options.limit.count,
      );
    }
    return this.client.zrangebyscore(key, min, max);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.client.sismember(key, member);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  async decrby(key: string, by: number): Promise<number> {
    return this.client.decrby(key, by);
  }

  /** Alias for expire — sets TTL in seconds */
  async setExpiry(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zrank(key: string, member: string): Promise<number | null> {
    return this.client.zrank(key, member);
  }

  async zrangeByScore(key: string, min: number | '-inf', max: number | '+inf'): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  /** Pop N members with lowest score (FIFO queue usage) */
  async zpopmin(key: string, count: number): Promise<string[]> {
    const raw = await this.client.zpopmin(key, count);
    // ioredis returns [member, score, member, score, ...] — extract members only
    const members: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      members.push(raw[i]);
    }
    return members;
  }

  // ── Atomic Stock Operations (Lua) ─────────────────────────

  /**
   * Atomically decrement stock — rejects if insufficient.
   * Uses Lua to prevent race conditions in concurrent purchases.
   */
  async atomicDecrementStock(stockKey: string, amount: number): Promise<StockOperationResult> {
    const result = await this.evalScript<[number, number]>(
      'atomicDecrement',
      LUA_ATOMIC_DECREMENT,
      [stockKey],
      [String(amount)],
    );

    return this.parseStockResult(result);
  }

  /**
   * Reserve stock for cart — decrements stock + creates reservation with TTL.
   * If TTL expires without checkout, Redis auto-releases.
   */
  async reserveStock(
    stockKey: string,
    reservationKey: string,
    amount: number,
    ttlSeconds: number,
  ): Promise<StockOperationResult> {
    const result = await this.evalScript<[number, number]>(
      'reserveStock',
      LUA_RESERVE_STOCK,
      [stockKey, reservationKey],
      [String(amount), String(ttlSeconds)],
    );

    return this.parseStockResult(result);
  }

  /**
   * Release a reservation — restores stock atomically.
   * Called on payment failure, cart clear, or timeout.
   */
  async releaseReservation(stockKey: string, reservationKey: string): Promise<number> {
    return this.evalScript<number>(
      'releaseReservation',
      LUA_RELEASE_RESERVATION,
      [stockKey, reservationKey],
      [],
    );
  }

  /**
   * Flash sale dequeue — atomically pops batch from queue.
   * Guarantees ordering: first-in = first-served.
   */
  async flashSaleDequeue(queueKey: string, batchSize: number): Promise<string[]> {
    return this.evalScript<string[]>(
      'flashSaleDequeue',
      LUA_FLASH_SALE_DEQUEUE,
      [queueKey],
      [String(batchSize)],
    );
  }

  // ── Internal ──────────────────────────────────────────────

  private async loadScripts(): Promise<void> {
    const scripts: Record<string, string> = {
      atomicDecrement: LUA_ATOMIC_DECREMENT,
      reserveStock: LUA_RESERVE_STOCK,
      releaseReservation: LUA_RELEASE_RESERVATION,
      flashSaleDequeue: LUA_FLASH_SALE_DEQUEUE,
    };

    await Promise.all(
      Object.entries(scripts).map(async ([name, script]) => {
        try {
          const sha = (await this.client.script('LOAD', script)) as string;
          this.scriptShas[name] = sha;
        } catch (err) {
          this.logger.warn(`Failed to load Lua script '${name}': ${String(err)}`);
        }
      }),
    );

    this.logger.log(`Loaded ${Object.keys(this.scriptShas).length} Lua scripts`);
  }

  private async evalScript<T>(
    name: string,
    script: string,
    keys: string[],
    args: string[],
  ): Promise<T> {
    const sha = this.scriptShas[name];

    if (sha) {
      try {
        // EVALSHA — faster than EVAL (no script transfer)
        return (await (this.client as Redis).evalsha(sha, keys.length, ...keys, ...args)) as T;
      } catch (err) {
        // NOSCRIPT: script was flushed from Redis cache
        if (err instanceof Error && err.message.startsWith('NOSCRIPT')) {
          delete this.scriptShas[name];
          // Fall through to EVAL
        } else {
          throw err;
        }
      }
    }

    // EVAL fallback — also caches script in Redis
    return (await (this.client as Redis).eval(script, keys.length, ...keys, ...args)) as T;
  }

  private parseStockResult(result: [number, number]): StockOperationResult {
    const [code, stock] = result;
    if (code === -2) return { success: false, newStock: 0, error: 'NOT_FOUND' };
    if (code === -1) return { success: false, newStock: stock, error: 'INSUFFICIENT' };
    return { success: true, newStock: stock };
  }
}
