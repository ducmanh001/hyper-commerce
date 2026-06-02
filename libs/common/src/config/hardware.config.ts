/**
 * HardwareConfig — CPU, memory, buffer, stream tuning — all env-driven.
 *
 * WHY: Hardware resources differ dramatically across environments:
 *   - Dev laptop: 8GB RAM, 4 cores → small buffer pools, no cluster
 *   - Staging: 16GB RAM, 8 cores → medium pools, cluster with 4 workers
 *   - Prod: 64GB RAM, 32 cores → large pools, cluster at full CPU count
 *
 * CLUSTER MODE:
 *   Node.js is single-threaded. To use all CPU cores, we run N worker processes.
 *   Each worker handles requests independently. The OS load-balancer distributes.
 *   Cost: N × memory usage. Benefit: N × throughput (roughly).
 *   Set CLUSTER_ENABLED=false in dev to ease debugging.
 *
 * BUFFER POOL:
 *   Pre-allocating Buffers avoids GC pressure from allocate-use-discard patterns.
 *   Small (4KB): HTTP request bodies, Redis RESP frames
 *   Medium (64KB): HTTP responses, Kafka messages
 *   Large (1MB): File uploads, export downloads, compression scratch space
 *
 * MEMORY MONITORING:
 *   Node.js V8 heap can grow silently. We sample periodically, detect trends,
 *   and log warnings before OOM kills the process.
 *   heapWarnPercent:    log a warning (PagerDuty alert in prod)
 *   heapCriticalPercent: call --expose-gc if available, scale down intake
 */
import { registerAs } from '@nestjs/config';

export interface HardwareConfigProps {
  bufferPool: {
    smallSize: number;    // bytes — default 4096 (4KB)
    smallCount: number;   // pool size
    mediumSize: number;   // bytes — default 65536 (64KB)
    mediumCount: number;
    largeSize: number;    // bytes — default 1048576 (1MB)
    largeCount: number;
    maxWaitMs: number;    // how long acquire() waits for a free buffer
  };
  memory: {
    monitorIntervalMs: number;
    heapWarnPercent: number;
    heapCriticalPercent: number;
    sampleCount: number;          // rolling window for leak detection
    leakThresholdMb: number;      // MB growth across sampleCount samples = leak
    gcSuggestThresholdMb: number; // trigger gc() hint if heap > N MB
  };
  cluster: {
    enabled: boolean;
    workerCount?: number;          // undefined → os.cpus().length
    respawnDelayMs: number;        // initial backoff before respawn
    maxRespawnDelayMs: number;     // exponential backoff cap
    maxRespawnsInWindow: number;   // crash loop detection
    respawnWindowMs: number;       // window for crash loop counter
  };
  compression: {
    algorithm: 'brotli' | 'gzip' | 'deflate';
    level: number;
    minSizeBytes: number;          // don't compress smaller payloads
  };
  streaming: {
    batchSize: number;             // BatchTransform default chunk size
    highWaterMarkBytes: number;    // Node.js stream internal buffer cap
  };
}

export default registerAs('hardware', (): HardwareConfigProps => ({
  bufferPool: {
    smallSize:   parseInt(process.env.BP_SMALL_SIZE   ?? '4096',    10),
    smallCount:  parseInt(process.env.BP_SMALL_COUNT  ?? '256',     10),
    mediumSize:  parseInt(process.env.BP_MEDIUM_SIZE  ?? '65536',   10),
    mediumCount: parseInt(process.env.BP_MEDIUM_COUNT ?? '64',      10),
    largeSize:   parseInt(process.env.BP_LARGE_SIZE   ?? '1048576', 10),
    largeCount:  parseInt(process.env.BP_LARGE_COUNT  ?? '16',      10),
    maxWaitMs:   parseInt(process.env.BP_MAX_WAIT_MS  ?? '50',      10),
  },
  memory: {
    monitorIntervalMs:      parseInt(process.env.MEM_INTERVAL_MS       ?? '30000', 10),
    heapWarnPercent:        parseFloat(process.env.MEM_WARN_PCT        ?? '0.70'),
    heapCriticalPercent:    parseFloat(process.env.MEM_CRITICAL_PCT    ?? '0.85'),
    sampleCount:            parseInt(process.env.MEM_SAMPLE_COUNT      ?? '10',    10),
    leakThresholdMb:        parseFloat(process.env.MEM_LEAK_THRESH_MB  ?? '50'),
    gcSuggestThresholdMb:   parseFloat(process.env.MEM_GC_THRESH_MB    ?? '256'),
  },
  cluster: {
    enabled:                process.env.CLUSTER_ENABLED === 'true',
    workerCount:            process.env.CLUSTER_WORKERS
                              ? parseInt(process.env.CLUSTER_WORKERS, 10)
                              : undefined,
    respawnDelayMs:         parseInt(process.env.CLUSTER_RESPAWN_DELAY_MS   ?? '1000',  10),
    maxRespawnDelayMs:      parseInt(process.env.CLUSTER_MAX_RESPAWN_MS     ?? '30000', 10),
    maxRespawnsInWindow:    parseInt(process.env.CLUSTER_MAX_RESPAWNS       ?? '5',     10),
    respawnWindowMs:        parseInt(process.env.CLUSTER_RESPAWN_WINDOW_MS  ?? '60000', 10),
  },
  compression: {
    algorithm: (process.env.COMPRESSION_ALGO as 'brotli' | 'gzip' | 'deflate') ?? 'brotli',
    level:        parseInt(process.env.COMPRESSION_LEVEL    ?? '4',    10),
    minSizeBytes: parseInt(process.env.COMPRESSION_MIN_SIZE ?? '1024', 10),
  },
  streaming: {
    batchSize:         parseInt(process.env.STREAM_BATCH_SIZE        ?? '100',   10),
    highWaterMarkBytes: parseInt(process.env.STREAM_HIGH_WATER_MARK  ?? '65536', 10),
  },
}));
