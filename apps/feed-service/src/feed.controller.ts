import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, CurrentUser, JwtPayload } from '@hypercommerce/common';
import { FeedRankerService } from './ranking/feed-ranker.service';

@Controller({ path: 'feed', version: '1' })
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly ranker: FeedRankerService) {}

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
  async liveFeed(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit = '20',
  ) {
    return this.ranker.getLiveStreams(user.sub, Math.min(parseInt(limit), 50));
  }
}
