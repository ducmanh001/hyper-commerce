// libs/common/src/utils/memory-monitor.util.ts
// Monitor Node.js heap/RSS/external memory and trigger alerts or GC.
//
// Usage:
//   const monitor = new MemoryMonitor({ warnThresholdMb: 400, criticalMb: 600 });
//   monitor.start(10_000); // check every 10s
//
// Alerts when:
//   - Heap used > 80% of heap total → potential memory leak
//   - RSS > criticalMb → container may OOM
//   - External memory > 100MB → Buffer leak (check Buffer pools)

import { Logger } from '@nestjs/common';
import * as v8 from 'v8';
import { promisify } from 'util';

const _gcTimer = promisify(setTimeout);

export interface MemorySnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  heapUsedPct: number;
  rssMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  v8HeapStats: {
    usedHeapSize: number;
    totalHeapSize: number;
    heapSizeLimit: number;
    mallocedMemory: number;
    peakMallocedMemory: number;
  };
  timestamp: number;
}

export interface MemoryMonitorOptions {
  /** Warn when heap used > this (MB). Default: 400 */
  warnThresholdMb: number;
  /** Critical when RSS > this (MB). Default: 600 */
  criticalThresholdMb: number;
  /** Try to run GC when heap > warnThreshold. Default: true */
  suggestGcOnWarn: boolean;
}

export class MemoryMonitor {
  private readonly logger = new Logger(MemoryMonitor.name);
  private intervalId: NodeJS.Timeout | null = null;
  private snapshots: MemorySnapshot[] = [];
  private readonly maxSnapshots = 60; // keep 10 min at 10s interval

  constructor(private readonly options: Partial<MemoryMonitorOptions> = {}) {}

  start(intervalMs = 10_000): void {
    this.intervalId = setInterval(() => this.collect(), intervalMs);
    // Don't prevent process exit
    this.intervalId.unref();
    this.logger.log(`Memory monitor started (interval: ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  snapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const v8Stats = v8.getHeapStatistics();

    return {
      heapUsedMb: mem.heapUsed / 1024 / 1024,
      heapTotalMb: mem.heapTotal / 1024 / 1024,
      heapUsedPct: mem.heapUsed / mem.heapTotal,
      rssMb: mem.rss / 1024 / 1024,
      externalMb: mem.external / 1024 / 1024,
      arrayBuffersMb: mem.arrayBuffers / 1024 / 1024,
      v8HeapStats: {
        usedHeapSize: v8Stats.used_heap_size,
        totalHeapSize: v8Stats.total_heap_size,
        heapSizeLimit: v8Stats.heap_size_limit,
        mallocedMemory: v8Stats.malloced_memory,
        peakMallocedMemory: v8Stats.peak_malloced_memory,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Detect potential memory leak by comparing heap growth rate.
   * Returns true if heap has grown consistently over the last N snapshots.
   */
  isLeaking(windowSize = 10): boolean {
    if (this.snapshots.length < windowSize) return false;

    const recent = this.snapshots.slice(-windowSize);
    const growthRates: number[] = [];

    for (let i = 1; i < recent.length; i++) {
      growthRates.push(recent[i].heapUsedMb - recent[i - 1].heapUsedMb);
    }

    // Leak if heap grows consistently (7/9 of intervals show growth)
    const growthCount = growthRates.filter((r) => r > 0).length;
    return growthCount >= Math.floor(windowSize * 0.7);
  }

  private collect(): void {
    const snap = this.snapshot();

    this.snapshots.push(snap);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    const warnMb = this.options.warnThresholdMb ?? 400;
    const criticalMb = this.options.criticalThresholdMb ?? 600;

    if (snap.rssMb > criticalMb) {
      this.logger.error(
        `CRITICAL: RSS ${snap.rssMb.toFixed(1)}MB exceeds ${criticalMb}MB limit. Risk of OOM kill.`,
        snap,
      );
    } else if (snap.heapUsedMb > warnMb || snap.heapUsedPct > 0.85) {
      this.logger.warn(
        `Memory warning: heap ${snap.heapUsedMb.toFixed(1)}MB (${(snap.heapUsedPct * 100).toFixed(0)}% of total)`,
      );

      // Suggest GC (only works if --expose-gc flag is set)
      if (this.options.suggestGcOnWarn !== false) {
        const globalWithGc = globalThis as unknown as { gc?: () => void };
        if (typeof globalWithGc.gc === 'function') {
          globalWithGc.gc();
          this.logger.log('Manual GC triggered');
        }
      }
    }

    if (snap.externalMb > 100) {
      this.logger.warn(
        `External memory (Buffers) high: ${snap.externalMb.toFixed(1)}MB — check BufferPool usage`,
      );
    }

    if (this.isLeaking()) {
      this.logger.error(
        `Memory leak detected: consistent heap growth over last ${this.maxSnapshots} samples`,
      );
    }
  }
}

/** Global instance — import and use directly in main.ts */
export const globalMemoryMonitor = new MemoryMonitor({
  warnThresholdMb: 400,
  criticalThresholdMb: 600,
  suggestGcOnWarn: true,
});
