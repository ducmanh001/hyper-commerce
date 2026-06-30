import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '@hypercommerce/common';
import { JwtAuthGuard, CurrentUser } from '@hypercommerce/common';
import type { FeedRankerService } from './ranking/feed-ranker.service';
import type { FeedService } from './feed.service';

@Controller({ path: 'feed', version: '1' })
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(
    private readonly ranker: FeedRankerService,
    private readonly feedService: FeedService,
  ) {}

  /**
   * GET /v1/feed/home — personalized home feed for current user.
   * Hybrid: follows + trending + recommended products.
   * Cursor-paginated (cursor = base64 encoded last item's score:id).
   */
  @Get('home')
  async homeFeed(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    return this.ranker.rankFeedForUser(user.sub, {
      cursor,
      limit: Math.min(parseInt(limit), 50),
    });
  }

  /**
   * GET /v1/feed/trending — global trending feed (no auth required in theory,
   * but gated here so we can personalize based on country).
   */
  @Get('trending')
  async trending(
    @CurrentUser() user: JwtPayload,
    @Query('country') country = 'VN',
    @Query('limit') limit = '30',
  ) {
    return this.ranker.getTrending(country, Math.min(parseInt(limit), 100));
  }

  /**
   * GET /v1/feed/live — live streams ranked by viewer count + relevance.
   */
  @Get('live')
  async liveFeed(@CurrentUser() user: JwtPayload, @Query('limit') limit = '20') {
    return this.ranker.getLiveStreams(user.sub, Math.min(parseInt(limit), 50));
  }

  /**
   * GET /v1/feed/ranked — personalized ranked feed using v1 linear scoring.
   *
   * Scoring formula (social.agent.md):
   *   score = completionRate×0.30 + purchaseRate×0.20 + userInterest×0.20
   *         + decay×0.15 + shareRate×0.15
   *   + business boosts: sponsored ×1.5, flash-sale ×1.3, seller-trust ×{0.5–1}
   *
   * A/B variant selected from Redis feed:ab:{userId} (TTL=7d).
   * Response cached at feed:feat:user:{userId} (TTL=300s).
   * Cache invalidated on new post fan-out.
   */
  @Get('ranked')
  async rankedFeed(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    return this.feedService.getRankedFeed(user.sub, cursor, Math.min(parseInt(limit), 50));
  }
}
