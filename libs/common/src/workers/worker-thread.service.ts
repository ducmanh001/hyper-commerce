/**
 * WorkerThreadPool
 *
 * Node.js is single-threaded for JS execution. CPU-bound operations
 * (report generation, ML inference, image processing, encryption at scale)
 * block the event loop and starve all other requests.
 *
 * Solution: Worker Threads (Node.js 12+, stable in 16+).
 * This service maintains a pool of persistent worker threads — no spawn
 * overhead per task (unlike child_process.fork).
 *
 * Why Worker Threads over Cluster?
 * - Cluster duplicates the entire process (heavy).
 * - Worker Threads share memory via SharedArrayBuffer — zero-copy for large payloads.
 * - Worker Threads are the standard for CPU-bound within a single process.
 *
 * Pool size default: hardwareConcurrency - 1 (keep one thread for I/O).
 * Configurable via WORKER_POOL_SIZE env var.
 *
 * Supported task types:
 *   - 'REPORT_CSV':     aggregate SQL result → CSV rows (CPU: string building)
 *   - 'FRAUD_SCORE':    feature extraction + logistic regression (CPU: math)
 *   - 'HASH_PASSWORD':  bcrypt cost>12 on bulk import (CPU: crypto)
 *   - 'RANK_FEED':      ML scoring for feed items (CPU: vector math)
 *   - 'COMPRESS_BATCH': gzip a batch of records before S3 upload (CPU: zlib)
 */

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';

export type WorkerTaskType =
  | 'REPORT_CSV'
  | 'FRAUD_SCORE'
  | 'HASH_PASSWORD'
  | 'RANK_FEED'
  | 'COMPRESS_BATCH';

export interface WorkerTask<T = unknown> {
  type: WorkerTaskType;
  payload: T;
}

interface PendingTask {
  task: WorkerTask;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

@Injectable()
export class WorkerThreadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerThreadService.name);
  private readonly poolSize: number;
  private pool: PoolWorker[] = [];
  private queue: PendingTask[] = [];

  constructor() {
    this.poolSize =
      parseInt(process.env['WORKER_POOL_SIZE'] ?? '0', 10) || Math.max(1, os.cpus().length - 1);
  }

  onModuleInit(): void {
    this.logger.log(`Initialising worker thread pool (size=${this.poolSize})`);
    for (let i = 0; i < this.poolSize; i++) {
      this.spawnWorker();
    }
  }

  onModuleDestroy(): void {
    this.logger.log('Terminating worker thread pool');
    for (const pw of this.pool) {
      pw.worker.terminate().catch(() => void 0);
    }
  }

  /**
   * Execute a CPU-bound task in a worker thread.
   * Returns a Promise that resolves when the worker completes.
   * If all workers are busy the task is queued (FIFO).
   */
  run<Result = unknown>(task: WorkerTask): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const idle = this.pool.find((pw) => !pw.busy);
      if (idle) {
        this.dispatch(idle, { task, resolve: resolve as (v: unknown) => void, reject });
      } else {
        this.queue.push({ task, resolve: resolve as (v: unknown) => void, reject });
        this.logger.warn(
          `Worker pool saturated — task ${task.type} queued (queue=${this.queue.length})`,
        );
      }
    });
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private spawnWorker(): void {
    // Inline worker script path — tasks handled in same-process worker thread
    const workerScript = path.resolve(__dirname, 'worker-tasks.js');

    const worker = new Worker(workerScript, {
      workerData: { poolSize: this.poolSize },
    });

    const pw: PoolWorker = { worker, busy: false };
    this.pool.push(pw);

    worker.on('message', (result: { id: string; data: unknown; error?: string }) => {
      // resolved by the pending task's Promise
      pw.busy = false;
      const next = this.queue.shift();
      if (next) this.dispatch(pw, next);
    });

    worker.on('error', (err) => {
      this.logger.error(`Worker error: ${err.message}`);
      pw.busy = false;
      // Replace crashed worker
      const idx = this.pool.indexOf(pw);
      if (idx !== -1) this.pool.splice(idx, 1);
      this.spawnWorker();
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.logger.error(`Worker exited with code ${code}`);
      }
    });
  }

  private dispatch(pw: PoolWorker, pending: PendingTask): void {
    pw.busy = true;

    const handler = (result: { data?: unknown; error?: string }): void => {
      pw.worker.off('message', handler);
      if (result.error) {
        pending.reject(new Error(result.error));
      } else {
        pending.resolve(result.data);
      }
    };

    pw.worker.on('message', handler);
    pw.worker.postMessage(pending.task);
  }
}
