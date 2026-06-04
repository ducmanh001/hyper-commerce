import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import type { KafkaProducerService } from '@hypercommerce/kafka';

// Live stream viewer queue — like a ticket system for limited-capacity events.
//
// Tiers → max concurrent viewers:
//   FREE       →   1,000
//   BASIC      →   5,000
//   PRO        →  50,000
//   ENTERPRISE → unlimited (Number.MAX_SAFE_INTEGER)
//
// Redis keys:
//   live:capacity:{streamId}           → current viewer count (INCR/DECR)
//   live:queue:{streamId}              → sorted set (score = join timestamp)
//   live:queue:admitted:{streamId}     → set of admitted socket IDs
//   live:queue:meta:{streamId}         → stream metadata (capacity, tier)

const TIER_CAPACITY: Record<string, number> = {
  FREE: 1_000,
  BASIC: 5_000,
  PRO: 50_000,
  ENTERPRISE: Number.MAX_SAFE_INTEGER,
};

const QUEUE_EXPIRY = 3600 * 2; // 2h — streams rarely go over 2h

export interface QueueJoinResult {
  admitted: boolean;
  /** null if admitted immediately */
  queuePosition: number | null;
  /** Estimated wait time in minutes (based on avg viewer session 15min) */
  estimatedWaitMinutes: number | null;
  totalInQueue: number;
}

export interface QueueStatus {
  currentViewers: number;
  maxCapacity: number;
  inQueue: number;
  userPosition?: number;
}

@Injectable()
export class LiveQueueService {
  private readonly logger = new Logger(LiveQueueService.name);
  private readonly AVG_SESSION_MINUTES = 15; // Used for wait estimation

  constructor(
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
  ) {}

  // ── Viewer joins stream ────────────────────────────────────

  async joinStream(
    streamId: string,
    userId: string,
    socketId: string,
    sellerTier: string = 'FREE',
  ): Promise<QueueJoinResult> {
    const capacity = TIER_CAPACITY[sellerTier] ?? TIER_CAPACITY.FREE;
    const capacityKey = `live:capacity:${streamId}`;
    const queueKey = `live:queue:${streamId}`;
    const admittedKey = `live:queue:admitted:${streamId}`;

    // Get current viewer count
    const currentViewersStr = await this.redis.get(capacityKey);
    const currentViewers = parseInt(currentViewersStr ?? '0', 10);

    if (currentViewers < capacity) {
      // Capacity available — admit immediately
      await this.redis.incr(capacityKey);
      await this.redis.setExpiry(capacityKey, QUEUE_EXPIRY);
      await this.redis.sadd(admittedKey, socketId);
      await this.redis.setExpiry(admittedKey, QUEUE_EXPIRY);

      this.logger.debug(
        `User ${userId} admitted to stream ${streamId} (${currentViewers + 1}/${capacity})`,
      );
      return { admitted: true, queuePosition: null, estimatedWaitMinutes: null, totalInQueue: 0 };
    }

    // Over capacity — add to queue
    const score = Date.now(); // FIFO by join timestamp
    await this.redis.zadd(queueKey, score, `${userId}:${socketId}`);
    await this.redis.setExpiry(queueKey, QUEUE_EXPIRY);

    const position = await this.redis.zrank(queueKey, `${userId}:${socketId}`);
    const totalInQueue = await this.redis.zcard(queueKey);
    const queuePos = position !== null ? position + 1 : totalInQueue;
    const estimatedWaitMinutes = Math.ceil(queuePos / (capacity / this.AVG_SESSION_MINUTES));

    this.logger.debug(
      `User ${userId} queued for stream ${streamId} at position ${queuePos}/${totalInQueue}`,
    );

    return {
      admitted: false,
      queuePosition: queuePos,
      estimatedWaitMinutes,
      totalInQueue,
    };
  }

  // ── Viewer leaves stream (admit next in queue) ─────────────

  async leaveStream(streamId: string, userId: string, socketId: string): Promise<void> {
    const capacityKey = `live:capacity:${streamId}`;
    const admittedKey = `live:queue:admitted:${streamId}`;

    await this.redis.decr(capacityKey);
    await this.redis.srem(admittedKey, socketId);

    // Admit next person from queue
    const nextEntry = await this.admitNext(streamId);
    if (nextEntry) {
      const [nextUserId, nextSocketId] = nextEntry.split(':');
      this.logger.debug(`Admitting next in queue: ${nextUserId} for stream ${streamId}`);

      // Publish event — live.gateway.ts will push WebSocket notification to admitted user
      await this.kafka.publish({
        topic: 'live.queue_admitted',
        partitionKey: streamId,
        value: {
          streamId,
          userId: nextUserId,
          socketId: nextSocketId,
          correlationId: streamId,
        },
      });
    }
  }

  // ── Get queue status ───────────────────────────────────────

  async getQueueStatus(streamId: string, userId?: string): Promise<QueueStatus> {
    const capacityKey = `live:capacity:${streamId}`;
    const queueKey = `live:queue:${streamId}`;
    const metaKey = `live:queue:meta:${streamId}`;

    const [currentViewersStr, inQueue, metaStr] = await Promise.all([
      this.redis.get(capacityKey),
      this.redis.zcard(queueKey),
      this.redis.get(metaKey),
    ]);

    const meta = metaStr ? JSON.parse(metaStr) : { tier: 'FREE' };
    const maxCapacity = TIER_CAPACITY[meta.tier as string] ?? TIER_CAPACITY.FREE;
    let userPosition: number | undefined;

    if (userId) {
      const entries = await this.redis.zrangeByScore(queueKey, '-inf', '+inf');
      const idx = entries.findIndex((e) => e.startsWith(`${userId}:`));
      if (idx !== -1) userPosition = idx + 1;
    }

    return {
      currentViewers: parseInt(currentViewersStr ?? '0', 10),
      maxCapacity,
      inQueue,
      userPosition,
    };
  }

  // ── Called when stream ends — cleanup ─────────────────────

  async endStream(streamId: string): Promise<void> {
    const capacityKey = `live:capacity:${streamId}`;
    const queueKey = `live:queue:${streamId}`;
    const admittedKey = `live:queue:admitted:${streamId}`;
    const metaKey = `live:queue:meta:${streamId}`;

    // Notify all queued users that stream ended
    const queued = await this.redis.zrangeByScore(queueKey, '-inf', '+inf');
    for (const entry of queued) {
      const [userId] = entry.split(':');
      await this.kafka.publish({
        topic: 'live.queue_stream_ended',
        partitionKey: streamId,
        value: { streamId, userId, correlationId: streamId },
      });
    }

    // Cleanup Redis keys
    await Promise.all([
      this.redis.del(capacityKey),
      this.redis.del(queueKey),
      this.redis.del(admittedKey),
      this.redis.del(metaKey),
    ]);

    this.logger.log(`Stream ${streamId} ended, queue cleaned up`);
  }

  // ── Set stream capacity metadata ───────────────────────────

  async initStream(streamId: string, sellerTier: string): Promise<void> {
    const metaKey = `live:queue:meta:${streamId}`;
    await this.redis.set(metaKey, JSON.stringify({ tier: sellerTier }), QUEUE_EXPIRY);
  }

  // ── Private ────────────────────────────────────────────────

  private async admitNext(streamId: string): Promise<string | null> {
    const queueKey = `live:queue:${streamId}`;
    const admittedKey = `live:queue:admitted:${streamId}`;
    const capacityKey = `live:capacity:${streamId}`;

    // Pop lowest-score (earliest join time) entry from queue
    const entries = await this.redis.zpopmin(queueKey, 1);
    if (!entries || entries.length === 0) return null;

    const entry = entries[0];
    const [, socketId] = entry.split(':');

    await this.redis.incr(capacityKey);
    await this.redis.sadd(admittedKey, socketId);

    return entry;
  }
}
