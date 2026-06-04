/**
 * MemoryLifecycleService — MemoryMonitor wired into NestJS app lifecycle
 *
 * WHY: Memory issues are silent killers. Without monitoring:
 *   - A leak slowly grows until OOM kills the process in production at 3am
 *   - You get no warning, no chance to shed load, no graceful degradation
 *
 * HOW IT WORKS:
 *   onApplicationBootstrap → starts sampling heap every N seconds
 *   onApplicationShutdown  → stops sampling, flushes last stats
 *
 * DETECTION ALGORITHM:
 *   1. Collect rolling window of {heapUsed} samples
 *   2. If heapUsed at sample[N] - heapUsed at sample[0] > leakThresholdMb
 *      AND all samples are monotonically increasing → likely leak
 *   3. Emit WARNING (not ERROR) — operator decides to restart/alert
 *
 * INTEGRATION WITH CLUSTER:
 *   Each worker monitors its own heap independently.
 *   The primary process monitors worker RSS via cluster.workers[id].process.memoryUsage()
 *
 * BACKPRESSURE:
 *   When heap > criticalPercent, we stop accepting new jobs/requests
 *   by setting a shared flag that rate-limit guards check.
 *   This is "shed load before you crash" — much better than OOM kill.
 */
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { MemoryMonitor } from '../utils/memory-monitor.util';
import type { HardwareConfigProps } from '../config/hardware.config';
import hardwareConfig from '../config/hardware.config';

@Injectable()
export class MemoryLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MemoryLifecycleService.name);
  private readonly monitor: MemoryMonitor;

  /** Public flag read by rate-limit guards to shed load under memory pressure */
  isUnderPressure = false;

  constructor(@Inject(hardwareConfig.KEY) private readonly config: HardwareConfigProps) {
    this.monitor = new MemoryMonitor({
      warnThresholdMb: config.memory.heapWarnPercent ? undefined : undefined,
      criticalThresholdMb: config.memory.heapCriticalPercent ? undefined : undefined,
    });
  }

  onApplicationBootstrap(): void {
    const { monitorIntervalMs, heapWarnPercent, heapCriticalPercent } = this.config.memory;

    this.monitor.start(monitorIntervalMs);

    // Poll for pressure using setInterval + snapshot()
    setInterval(() => {
      const snap = this.monitor.snapshot();
      const ratio = snap.heapUsedPct;

      if (ratio >= heapCriticalPercent) {
        this.logger.error(
          `MEMORY CRITICAL: heap ${snap.heapUsedMb.toFixed(0)}MB / ${snap.heapTotalMb.toFixed(0)}MB ` +
            `(${(ratio * 100).toFixed(1)}%) — shedding load`,
        );
        this.isUnderPressure = true;
      } else if (ratio >= heapWarnPercent) {
        this.logger.warn(
          `MEMORY WARNING: heap ${snap.heapUsedMb.toFixed(0)}MB / ${snap.heapTotalMb.toFixed(0)}MB ` +
            `(${(ratio * 100).toFixed(1)}%)`,
        );
        this.isUnderPressure = false;
      } else {
        this.isUnderPressure = false;
      }

      if (this.monitor.isLeaking()) {
        this.logger.error(`MEMORY LEAK DETECTED — consistent heap growth`);
      }
    }, monitorIntervalMs).unref();

    this.logger.log(
      `Memory monitoring started (interval=${monitorIntervalMs}ms, ` +
        `warn=${heapWarnPercent * 100}%, critical=${heapCriticalPercent * 100}%)`,
    );
  }

  onApplicationShutdown(signal?: string): void {
    this.monitor.stop();
    const snap = this.monitor.snapshot();
    this.logger.log(
      `Shutdown [${signal ?? 'unknown'}] — final heap: ${snap.heapUsedMb.toFixed(0)}MB`,
    );
  }

  /** Current snapshot for health-check endpoints */
  getMemoryStats() {
    return this.monitor.snapshot();
  }
}
