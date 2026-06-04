// libs/common/src/utils/stream.util.ts
// Stream utilities for high-throughput data processing.
// Avoids loading large datasets into memory — process as streams.
//
// Use cases:
//   - Export 100K order records to CSV without OOM
//   - Process bulk product imports in chunks
//   - Stream ClickHouse query results to HTTP response
//   - Pipeline: read DB → transform → gzip → S3 upload

import type { Writable, TransformOptions } from 'stream';
import { Transform, Readable, pipeline } from 'stream';
import { promisify } from 'util';
import zlib from 'zlib';

export const pipelineAsync = promisify(pipeline);

// ── Batch Transform ───────────────────────────────────────────
// Accumulates items and flushes in configurable batches.
// Prevents N+1 DB queries for stream processing.

export class BatchTransform<T, R> extends Transform {
  private batch: T[] = [];

  constructor(
    private readonly batchSize: number,
    private readonly processBatch: (batch: T[]) => Promise<R[]>,
    opts?: TransformOptions,
  ) {
    super({ objectMode: true, ...opts });
  }

  _transform(chunk: T, _encoding: string, callback: (error?: Error | null) => void): void {
    this.batch.push(chunk);

    if (this.batch.length >= this.batchSize) {
      const currentBatch = this.batch;
      this.batch = [];

      this.processBatch(currentBatch)
        .then((results) => {
          for (const result of results) {
            this.push(result);
          }
          callback();
        })
        .catch(callback);
    } else {
      callback();
    }
  }

  _flush(callback: (error?: Error | null) => void): void {
    if (this.batch.length === 0) {
      callback();
      return;
    }

    this.processBatch(this.batch)
      .then((results) => {
        for (const result of results) {
          this.push(result);
        }
        callback();
      })
      .catch(callback);
  }
}

// ── JSON Stringify Transform ──────────────────────────────────
// Converts object stream to NDJSON (newline-delimited JSON).
// Memory-efficient alternative to JSON.stringify(largeArray).

export class NdJsonTransform extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  _transform(obj: unknown, _encoding: string, callback: () => void): void {
    this.push(JSON.stringify(obj) + '\n');
    callback();
  }
}

// ── CSV Transform ─────────────────────────────────────────────
export class CsvTransform extends Transform {
  private isFirst = true;

  constructor(private readonly headers: string[]) {
    super({ objectMode: true });
  }

  _transform(row: Record<string, unknown>, _encoding: string, callback: () => void): void {
    if (this.isFirst) {
      this.push(this.headers.join(',') + '\n');
      this.isFirst = false;
    }

    const values = this.headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape commas and quotes in CSV
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });

    this.push(values.join(',') + '\n');
    callback();
  }
}

// ── Gzip Pipeline ─────────────────────────────────────────────
/**
 * Create a gzip + pipe chain for compressing large outputs.
 * Usage: readable.pipe(createGzipPipeline()).pipe(response);
 */
export function createGzipPipeline(): Transform {
  return zlib.createGzip({
    level: zlib.constants.Z_BEST_SPEED, // speed > compression ratio
    chunkSize: 16 * 1024,
  });
}

/**
 * Create a readable stream from an async generator.
 * Useful for streaming DB cursor results without loading all into memory.
 */
export function readableFromAsyncGenerator<T>(gen: AsyncGenerator<T>): Readable {
  return new Readable({
    objectMode: true,
    async read() {
      const { value, done } = await gen.next();
      if (done) {
        this.push(null);
      } else {
        this.push(value);
      }
    },
  });
}

/**
 * Backpressure-aware writer — waits for drain before writing.
 * Prevents unbounded memory growth when writing to slow sinks.
 */
export async function writeWithBackpressure(
  writable: Writable,
  data: Buffer | string,
): Promise<void> {
  const canContinue = writable.write(data);
  if (!canContinue) {
    await new Promise<void>((resolve) => writable.once('drain', resolve));
  }
}
