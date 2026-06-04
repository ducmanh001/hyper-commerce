// libs/queue/src/queue.factory.ts
// Factory functions for creating BullMQ Queue and Worker instances.
// Centralizes all Redis connection config and queue options.

import {
  Queue,
  Worker,
  QueueEvents,
  type WorkerOptions,
  type QueueOptions,
  type Job,
} from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { JOB_DEFAULT_OPTIONS } from './constants/queue.constants';

// Shared connection — all queues/workers reuse same connection pool
let _redisConnection: RedisOptions | null = null;

export function setQueueRedisConnection(options: RedisOptions): void {
  _redisConnection = options;
}

function getConnection(): RedisOptions {
  if (!_redisConnection) {
    throw new Error(
      'Queue Redis connection not initialized. Call setQueueRedisConnection() first.',
    );
  }
  return _redisConnection;
}

// ── Queue Factory ─────────────────────────────────────────────

export function createQueue<T = unknown>(name: string, options?: Partial<QueueOptions>): Queue<T> {
  return new Queue<T>(name, {
    connection: getConnection(),
    defaultJobOptions: JOB_DEFAULT_OPTIONS.CRITICAL,
    ...options,
  });
}

export function createCriticalQueue<T = unknown>(name: string): Queue<T> {
  return createQueue<T>(name, {
    defaultJobOptions: JOB_DEFAULT_OPTIONS.CRITICAL,
  });
}

export function createNonCriticalQueue<T = unknown>(name: string): Queue<T> {
  return createQueue<T>(name, {
    defaultJobOptions: JOB_DEFAULT_OPTIONS.NON_CRITICAL,
  });
}

export function createBestEffortQueue<T = unknown>(name: string): Queue<T> {
  return createQueue<T>(name, {
    defaultJobOptions: JOB_DEFAULT_OPTIONS.BEST_EFFORT,
  });
}

// ── Worker Factory ────────────────────────────────────────────

export function createWorker<T = unknown, R = unknown>(
  name: string,
  processor: (job: Job<T>) => Promise<R>,
  options?: Partial<WorkerOptions>,
): Worker<T, R> {
  return new Worker<T, R>(name, processor, {
    connection: getConnection(),
    concurrency: 10,
    limiter: {
      max: 100,
      duration: 1000,
    },
    ...options,
  });
}

// ── QueueEvents Factory ───────────────────────────────────────
// Use for monitoring queue events (completed, failed, stalled)

export function createQueueEvents(name: string): QueueEvents {
  return new QueueEvents(name, {
    connection: getConnection(),
  });
}

// ── Delayed Job Scheduler ─────────────────────────────────────

export async function scheduleJob<T>(
  queue: Queue<T>,
  jobName: string,
  data: T,
  _delayMs: number,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = await queue.add(jobName as any, data as any, {
    ...JOB_DEFAULT_OPTIONS.SCHEDULED,
  });
  return job.id ?? '';
}

// ── Repeatable Jobs (cron-like) ───────────────────────────────

export async function addRepeatableJob<T>(
  queue: Queue<T>,
  jobName: string,
  data: T,
  _cronPattern: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await queue.add(jobName as any, data as any, {
    ...JOB_DEFAULT_OPTIONS.SCHEDULED,
  });
}
