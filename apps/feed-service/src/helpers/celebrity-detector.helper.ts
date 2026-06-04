/**
 * CelebrityDetectorHelper — Feed Service local copy
 *
 * Encapsulates the logic for deciding fan-out behavior based on
 * follower counts and user activity signals.
 *
 * CELEBRITY THRESHOLD:
 *   User with ≥ 50K followers is considered a "celebrity".
 *   For celebrities: PULL strategy (readers query on demand).
 *   For regular users: PUSH strategy (write to each follower's feed).
 *   For mega-celebrities (≥ 1M): HYBRID (push to active followers only).
 *
 * WHY these thresholds (educated estimates):
 *   - 50K followers × 100ms per write = 5000 seconds (too slow for PUSH)
 *   - PULL adds ~50ms query overhead per feed load (acceptable)
 *   - HYBRID (1M+): only ~20% of followers are active within 7 days
 *     so we can push to 200K instead of 1M, saving 80% of writes
 */
import { Injectable } from '@nestjs/common';

export const CELEBRITY_THRESHOLD = 50_000;
export const MEGA_CELEBRITY_THRESHOLD = 1_000_000;
export const ACTIVE_FOLLOWER_DAYS = 7;

@Injectable()
export class CelebrityDetectorHelper {
  /**
   * Decide optimal fan-out batch size based on follower count.
   * Larger follower count → smaller batch (more workers share the load).
   */
  getFanoutBatchSize(followerCount: number): number {
    if (followerCount > MEGA_CELEBRITY_THRESHOLD) return 200;
    if (followerCount > 100_000) return 300;
    return 500; // default for regular users
  }

  /**
   * Should we push to this follower in HYBRID mode?
   * Returns true only for followers active in the last N days.
   *
   * WHY: Ghost accounts (never log in) still follow celebs.
   * Pushing to them wastes writes. Skip them — they'll catch up via PULL.
   */
  shouldPushToFollower(strategy: 'PUSH' | 'PULL' | 'HYBRID', lastActiveAt: Date | null): boolean {
    if (strategy !== 'HYBRID') return true;
    if (!lastActiveAt) return false; // never logged in → skip

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ACTIVE_FOLLOWER_DAYS);
    return lastActiveAt > cutoff;
  }

  /**
   * Determine fan-out strategy for a given follower count.
   */
  decideFanout(followerCount: number): 'PUSH' | 'PULL' | 'HYBRID' {
    if (followerCount >= MEGA_CELEBRITY_THRESHOLD) return 'HYBRID';
    if (followerCount >= CELEBRITY_THRESHOLD) return 'PULL';
    return 'PUSH';
  }
}
