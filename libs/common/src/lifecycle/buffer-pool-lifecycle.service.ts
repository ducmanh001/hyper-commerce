/**
 * BufferPoolLifecycleService — Pre-allocates Buffer pools on startup, releases on shutdown.
 *
 * WHY BUFFER POOLS:
 *   Node.js allocates Buffer.alloc() from V8 heap OR from off-heap ArrayBuffer.
 *   For high-throughput HTTP/WebSocket, allocating a new Buffer per request
 *   causes GC pressure proportional to RPS.
 *
 *   With a pool: N buffers are allocated ONCE at startup. Requests borrow a buffer,
 *   use it, return it. V8 GC never sees request-path allocations.
 *
 * SIZING GUIDE:
 *   small  (4KB):  HTTP request body parsing, Redis pipeline frames
 *   medium (64KB): HTTP responses, gRPC messages, Kafka produce messages
 *   large  (1MB):  File uploads, export downloads, brotli compression scratch
 *
 *   count = peak concurrent ops × 1.5 safety margin
 *   e.g., 200 RPS × 50ms avg response time = 10 in-flight → pool size 16-20
 *
 * TRADEOFF:
 *   PRO: Zero GC on critical path, predictable latency
 *   CON: Reserved memory even when idle. Memory usage = smallCount × smallSize + ...
 *        256 small (4KB) + 64 medium (64KB) + 16 large (1MB) = 1MB + 4MB + 16MB = 21MB fixed
 *
 * USAGE in application code:
 *   const buf = SMALL_BUFFER_POOL.acquire();
 *   try {
 *     buf.write(data, 0);
 *     socket.write(buf.slice(0, dataLen));
 *   } finally {
 *     SMALL_BUFFER_POOL.release(buf);
 *   }
 */
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { BufferPool } from '../utils/buffer-pool.util';
import type { HardwareConfigProps } from '../config/hardware.config';
import hardwareConfig from '../config/hardware.config';

@Injectable()
export class BufferPoolLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BufferPoolLifecycleService.name);

  smallPool!: BufferPool;
  mediumPool!: BufferPool;
  largePool!: BufferPool;

  constructor(@Inject(hardwareConfig.KEY) private readonly config: HardwareConfigProps) {}

  onApplicationBootstrap(): void {
    const { smallSize, smallCount, mediumSize, mediumCount, largeSize, largeCount } =
      this.config.bufferPool;

    this.smallPool = new BufferPool({ blockSize: smallSize, maxBlocks: smallCount });
    this.mediumPool = new BufferPool({ blockSize: mediumSize, maxBlocks: mediumCount });
    this.largePool = new BufferPool({ blockSize: largeSize, maxBlocks: largeCount });

    const totalMb =
      (smallSize * smallCount + mediumSize * mediumCount + largeSize * largeCount) / 1024 / 1024;

    this.logger.log(
      `Buffer pools initialized — ` +
        `small: ${smallCount}×${smallSize / 1024}KB, ` +
        `medium: ${mediumCount}×${mediumSize / 1024}KB, ` +
        `large: ${largeCount}×${largeSize / 1024 / 1024}MB ` +
        `(total reserved: ${totalMb.toFixed(1)}MB)`,
    );
  }

  onApplicationShutdown(): void {
    // BufferPool has no explicit release — GC will reclaim when references drop
    this.logger.log('Buffer pools released');
  }

  /** Stats for health-check endpoint */
  getStats() {
    return {
      small: this.smallPool?.stats,
      medium: this.mediumPool?.stats,
      large: this.largePool?.stats,
    };
  }
}
