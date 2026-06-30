// ============================================================
// HYPERCOMMERCE — A/B Weight Resolver
// Reads the A/B variant for a user from Redis and returns the
// corresponding ranking weight set.
//
// Redis key: feed:ab:{userId}   value: 'v1' | 'v2'   TTL: 7d
//
// On cache miss: assign randomly (50/50) and persist.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';

export type AbVariant = 'v1' | 'v2';

export interface RankingWeights {
  completionRate: number;
  purchaseRate: number;
  userInterest: number;
  decay: number;
  shareRate: number;
}

const WEIGHTS_BY_VARIANT: Record<AbVariant, RankingWeights> = {
  v1: APP_CONSTANTS.FEED_RANK_WEIGHTS_V1,
  v2: APP_CONSTANTS.FEED_RANK_WEIGHTS_V2,
};

@Injectable()
export class AbWeightResolverService {
  private readonly logger = new Logger(AbWeightResolverService.name);

  constructor(private readonly redis: RedisClientService) {}

  /**
   * Resolve the ranking weight set for a user.
   * Reads feed:ab:{userId} from Redis; assigns and persists on cache miss.
   */
  async resolveWeights(userId: string): Promise<{ weights: RankingWeights; variant: AbVariant }> {
    const variant = await this.getOrAssignVariant(userId);
    return { weights: WEIGHTS_BY_VARIANT[variant], variant };
  }

  private async getOrAssignVariant(userId: string): Promise<AbVariant> {
    const key = `${APP_CONSTANTS.REDIS_KEYS.FEED_AB_VARIANT}${userId}`;
    const client = this.redis.getClient();

    const stored = await client.get(key);
    if (stored === 'v1' || stored === 'v2') {
      return stored;
    }

    // Assign variant deterministically from userId hash to avoid thundering herd
    const variant: AbVariant = this.hashToVariant(userId);

    await client.set(key, variant, 'EX', APP_CONSTANTS.FEED_AB_TTL_SECONDS);

    this.logger.debug(`Assigned A/B variant ${variant} for user ${userId}`);
    return variant;
  }

  /**
   * Deterministic 50/50 split from the last byte of the userId UUID.
   * Avoids random churn when the Redis key expires mid-session.
   */
  private hashToVariant(userId: string): AbVariant {
    // UUID last segment, e.g. "...abc123ef" → last char code parity
    const lastChar = userId.replace(/-/g, '').slice(-1);
    const code = parseInt(lastChar, 16);
    return code % 2 === 0 ? 'v1' : 'v2';
  }
}
