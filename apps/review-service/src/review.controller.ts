import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { ReviewService, CreateReviewDto, ListReviewsQuery } from './review.service';

/** Minimal auth guard stub — real auth comes from api-gateway JWT validation */
class BuyerRequest {
  user: { userId: string; sellerId?: string };
}

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /**
   * POST /reviews
   * Buyer submits a review for a delivered order.
   * The review is saved as PENDING and moderated asynchronously.
   */
  @Post()
  async create(@Body() body: CreateReviewDto) {
    return this.reviewService.create(body);
  }

  /**
   * GET /reviews?productId=&page=&limit=&sort=newest|helpful|rating_asc|rating_desc
   * List approved reviews for a product (includes aggregate rating stats).
   */
  @Get()
  async list(
    @Query('productId') productId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('userId') userId?: string,
    @Query('minRating') minRating?: string,
    @Query('maxRating') maxRating?: string,
    @Query('sort') sort?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    const query: ListReviewsQuery = {
      productId,
      sellerId,
      userId,
      minRating: minRating ? Number(minRating) : undefined,
      maxRating: maxRating ? Number(maxRating) : undefined,
      sort: sort as ListReviewsQuery['sort'],
      page,
      limit,
    };
    return this.reviewService.list(query);
  }

  /**
   * GET /reviews/:id
   */
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviewService.findById(id);
  }

  /**
   * GET /reviews/product/:productId/stats
   * Aggregate rating distribution — cached in Redis (300s TTL).
   */
  @Get('product/:productId/stats')
  async productStats(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.reviewService.getProductRatingStats(productId);
  }

  /**
   * POST /reviews/:id/helpful
   * Buyer marks review as helpful (idempotent per user).
   */
  @Post(':id/helpful')
  async markHelpful(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.reviewService.markHelpful(id, userId);
  }

  /**
   * DELETE /reviews/:id/helpful
   * Buyer retracts helpful vote.
   */
  @Delete(':id/helpful')
  async unmarkHelpful(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.reviewService.unmarkHelpful(id, userId);
  }

  /**
   * POST /reviews/:id/reply
   * Seller adds a reply to a buyer review (one reply per review).
   */
  @Post(':id/reply')
  async addReply(
    @Param('id', ParseUUIDPipe) reviewId: string,
    @Body('sellerId', ParseUUIDPipe) sellerId: string,
    @Body('reply') reply: string,
  ) {
    return this.reviewService.addSellerReply({ sellerId, reviewId, reply });
  }

  /**
   * PATCH /reviews/:id/reply
   * Seller updates their existing reply.
   */
  @Patch(':id/reply')
  async updateReply(
    @Param('id', ParseUUIDPipe) reviewId: string,
    @Body('sellerId', ParseUUIDPipe) sellerId: string,
    @Body('reply') reply: string,
  ) {
    return this.reviewService.updateSellerReply({ sellerId, reviewId, reply });
  }
}
