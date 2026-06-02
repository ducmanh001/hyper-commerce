// ============================================================
// HYPERCOMMERCE — Celebrity Detector Helper
// Quyết định chiến lược fan-out dựa trên follower count.
// Đây là một trong những quyết định kiến trúc quan trọng nhất
// ở social platform: push vs pull vs hybrid.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import { RedisClientService } from '@hypercommerce/redis';

export type FanoutStrategy = 'PUSH' | 'PULL' | 'HYBRID';

/**
 * Fan-out Strategy Decision:
 *
 * PUSH (regular users < 10K followers):
 *   - Khi post, worker iterate qua toàn bộ follower list
 *   - Ghi trực tiếp vào feed table của từng follower
 *   - Pro: read time O(1) — feed đã sẵn sàng
 *   - Con: write amplification = followers count × 1 DB write/post
 *
 * PULL (celebrity > 10K followers):
 *   - Không ghi vào feed của ai khi post
 *   - Khi follower load feed, merge bài celebrity vào real-time
 *   - Pro: write amplification = 1 (chỉ 1 write vào post table)
 *   - Con: read time tăng nhẹ (1 extra query per page load)
 *
 * HYBRID (optional for mega-celebrity > 1M):
 *   - Push cho active followers (last login < 7 days)
 *   - Pull cho inactive followers
 *   - Pro: tránh lãng phí write cho ghost accounts
 *   - Con: phức tạp, cần track last_active
 *
 * Ngưỡng 10K được TikTok và Twitter dùng trong thực tế.
 * Bạn có thể điều chỉnh theo infrastructure capacity.
 */
@Injectable()
export class CelebrityDetectorHelper {
  private readonly logger = new Logger(CelebrityDetectorHelper.name);

  private readonly CELEBRITY_THRESHOLD = APP_CONSTANTS.CELEBRITY_FOLLOWER_THRESHOLD; // 10K
  private readonly MEGA_CELEBRITY_THRESHOLD = APP_CONSTANTS.MEGA_CELEBRITY_THRESHOLD; // 1M

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Decide fan-out strategy based on follower count.
   * This is called at POST time to know how to distribute content.
   */
  decideFanout(followerCount: number): FanoutStrategy {
    if (followerCount < this.CELEBRITY_THRESHOLD) return 'PUSH';
    if (followerCount < this.MEGA_CELEBRITY_THRESHOLD) return 'PULL';
    return 'HYBRID'; // Mega-celebrity: smart hybrid
  }

  /**
   * Check if a user is a celebrity (cached in Redis Set for O(1) lookup).
   * Redis SET sismember is atomic and ~0.3ms — used on hot paths.
   */
  async isCelebrity(userId: string): Promise<boolean> {
    const result = await this.redis.sismember(
      APP_CONSTANTS.REDIS_KEYS.CELEBRITY_LIST,
      userId,
    );
    return result === 1;
  }

  /**
   * Bulk check celebrity status — avoid N+1 queries when rendering feed.
   * Single Redis SMEMBERS + local Set intersection.
   */
  async bulkIsCelebrity(userIds: string[]): Promise<Map<string, boolean>> {
    if (!userIds.length) return new Map();

    const celebrities = await this.redis.smembers(
      APP_CONSTANTS.REDIS_KEYS.CELEBRITY_LIST,
    );
    const celebritySet = new Set(celebrities);

    return new Map(userIds.map((id) => [id, celebritySet.has(id)]));
  }

  /**
   * Compute estimated write cost before publishing a post.
   * Used by rate limiter / backpressure system.
   *
   * @returns estimated number of DB writes this post will trigger
   */
  estimateFanoutCost(followerCount: number): number {
    const strategy = this.decideFanout(followerCount);
    switch (strategy) {
      case 'PUSH':
        // 1 write per follower
        return followerCount;
      case 'PULL':
        // 1 write (just the post itself)
        return 1;
      case 'HYBRID':
        // Assume 30% active followers
        return Math.floor(followerCount * 0.3);
    }
  }

  /**
   * Compute fan-out batch size based on follower count.
   * Smaller batches for large accounts to avoid Kafka partition saturation.
   */
  getFanoutBatchSize(followerCount: number): number {
    if (followerCount < 1_000) return 500;
    if (followerCount < 10_000) return 200;
    return 100; // Celebrities — smaller batches, better parallelism
  }

  /**
   * Should a post from this user appear in a follower's feed right now?
   * For HYBRID strategy: only push to recently-active followers.
   *
   * @param lastActiveAt - ISO timestamp of follower's last activity
   */
  shouldPushToFollower(
    strategy: FanoutStrategy,
    lastActiveAt: string | null,
  ): boolean {
    if (strategy === 'PUSH') return true;
    if (strategy === 'PULL') return false;

    // HYBRID: push only to followers active in last 7 days
    if (!lastActiveAt) return false;
    const daysSinceActive =
      (Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActive <= 7;
  }
}
