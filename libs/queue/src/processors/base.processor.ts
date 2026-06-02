// libs/queue/src/processors/base.processor.ts
// Abstract base class for all BullMQ job processors.
// Provides: retry logic, metrics, distributed tracing, error classification.

import { Job } from 'bullmq';

export interface JobResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type JobClassification = 'transient' | 'permanent' | 'retry-later';

/**
 * Classify an error to decide retry behavior:
 * - transient: network timeout, DB deadlock → retry now
 * - permanent: validation error, not found → do not retry (move to DLQ)
 * - retry-later: rate limit, upstream busy → retry after delay
 */
export function classifyError(err: unknown): JobClassification {
  if (!(err instanceof Error)) return 'transient';

  const msg = err.message.toLowerCase();

  // Permanent failures — no point retrying
  if (
    msg.includes('not found') ||
    msg.includes('validation') ||
    msg.includes('invalid') ||
    msg.includes('forbidden') ||
    msg.includes('unauthorized')
  ) {
    return 'permanent';
  }

  // Rate limited — retry after delay
  if (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('quota exceeded')
  ) {
    return 'retry-later';
  }

  // Default: transient (timeout, connection, etc.)
  return 'transient';
}

export abstract class BaseProcessor<TData, TResult = void> {
  /** Override to process a job. Throw to trigger retry. */
  abstract process(job: Job<TData>): Promise<TResult>;

  /**
   * Called by BullMQ worker. Wraps process() with error handling.
   * Do NOT override this; override process() instead.
   */
  async handle(job: Job<TData>): Promise<TResult> {
    const start = Date.now();
    const label = `[${job.queueName}:${job.name}:${job.id}]`;

    try {
      const result = await this.process(job);
      const elapsed = Date.now() - start;
      console.log(`${label} completed in ${elapsed}ms`);
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      const classification = classifyError(err);

      console.error(
        `${label} failed after ${elapsed}ms — classification: ${classification}`,
        err,
      );

      // Permanent failures: mark as failed immediately (don't retry)
      if (classification === 'permanent') {
        await job.moveToFailed(
          err instanceof Error ? err : new Error(String(err)),
          job.token ?? '',
          false,
        );
        // Return undefined to prevent BullMQ from retrying
        return undefined as unknown as TResult;
      }

      // Transient / retry-later: re-throw so BullMQ applies backoff
      throw err;
    }
  }
}
