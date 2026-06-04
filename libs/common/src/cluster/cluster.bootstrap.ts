// libs/common/src/cluster/cluster.bootstrap.ts
// Node.js cluster mode for multi-core CPU utilization.
//
// In production containers (K8s), prefer running multiple pods
// over cluster mode (better isolation, independent restarts).
// Use cluster mode for:
//   - Single large VM deployments (dev/staging)
//   - Services needing in-process shared state (e.g. Trie autocomplete)
//
// Workers are auto-respawned on crash with exponential backoff
// to prevent fork-bomb on startup crashes.
//
// Usage in main.ts:
//   import { bootstrapWithCluster } from '@hypercommerce/common/cluster';
//   bootstrapWithCluster(bootstrap, { workers: 4 });

import cluster from 'cluster';
import os from 'os';
import { Logger } from '@nestjs/common';

const logger = new Logger('ClusterBootstrap');

export interface ClusterOptions {
  /**
   * Number of worker processes.
   * Default: min(cpuCount, 4) — cap at 4 for containers.
   */
  workers?: number;
  /**
   * Enable auto-respawn of crashed workers.
   * Default: true.
   */
  autoRespawn?: boolean;
  /**
   * Minimum delay before respawning (ms).
   * Increases exponentially up to maxRespawnDelayMs.
   * Default: 1000ms.
   */
  minRespawnDelayMs?: number;
  maxRespawnDelayMs?: number;
}

const DEFAULT_CLUSTER_OPTS: Required<ClusterOptions> = {
  workers: Math.min(os.cpus().length, 4),
  autoRespawn: true,
  minRespawnDelayMs: 1_000,
  maxRespawnDelayMs: 30_000,
};

/**
 * Bootstrap NestJS with Node.js cluster.
 * In primary process: fork workers.
 * In worker process: call the NestJS bootstrap function.
 *
 * @param appBootstrap - The NestJS bootstrap() function from main.ts
 * @param opts - Cluster options
 */
export function bootstrapWithCluster(
  appBootstrap: () => Promise<void>,
  opts: ClusterOptions = {},
): void {
  const options = { ...DEFAULT_CLUSTER_OPTS, ...opts };

  if (cluster.isPrimary) {
    logger.log(`Primary process ${process.pid} starting ${options.workers} workers`);

    // Track respawn delays per worker (for exponential backoff)
    const respawnDelays = new Map<number, number>();

    // Fork workers
    for (let i = 0; i < options.workers; i++) {
      const worker = cluster.fork();
      respawnDelays.set(worker.id, options.minRespawnDelayMs);
    }

    cluster.on('online', (worker) => {
      logger.log(`Worker ${worker.process.pid} is online`);
    });

    cluster.on('exit', (worker, code, signal) => {
      const reason = signal || `exit code ${code}`;
      logger.error(`Worker ${worker.process.pid} died (${reason})`);

      if (!options.autoRespawn) return;
      if (code === 0) return; // Graceful exit — don't respawn

      const delay = respawnDelays.get(worker.id) ?? options.minRespawnDelayMs;

      logger.warn(`Respawning worker in ${delay}ms...`);

      setTimeout(() => {
        const newWorker = cluster.fork();
        // Exponential backoff for next respawn
        const nextDelay = Math.min(delay * 2, options.maxRespawnDelayMs);
        respawnDelays.set(newWorker.id, nextDelay);
      }, delay);
    });

    // Graceful shutdown: SIGTERM primary → SIGTERM all workers
    process.on('SIGTERM', () => {
      logger.log('Primary received SIGTERM — shutting down workers');
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker?.kill('SIGTERM');
      }
    });
  } else {
    // Worker process: run the NestJS app
    logger.log(`Worker ${process.pid} started`);
    appBootstrap().catch((err) => {
      logger.error(`Worker ${process.pid} failed to start`, err);
      process.exit(1);
    });
  }
}

/**
 * Check if current process is running in cluster worker mode.
 */
export function isClusterWorker(): boolean {
  return cluster.isWorker;
}

/**
 * Get cluster worker ID (1-based) or 0 for primary.
 */
export function getWorkerId(): number {
  return cluster.worker?.id ?? 0;
}
