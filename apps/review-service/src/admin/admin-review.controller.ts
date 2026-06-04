import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { ReviewService } from '../review.service';

/** Internal admin endpoints for manual review moderation. Must only be accessible from admin-service or internal network. */
@Controller('admin/reviews')
export class AdminReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /**
   * GET /admin/reviews/pending?page=&limit=
   * Lists reviews in PENDING or FLAGGED state for human moderators.
   */
  @Get('pending')
  async listPending(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.reviewService.listPendingAdmin(page, limit);
  }

  /**
   * PATCH /admin/reviews/:id/approve
   * Human moderator approves a PENDING or FLAGGED review.
   */
  @Patch(':id/approve')
  async approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviewService.approve(id);
  }

  /**
   * PATCH /admin/reviews/:id/reject
   * Human moderator rejects a review with a reason.
   * The buyer receives a notification.
   */
  @Patch(':id/reject')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason: string) {
    return this.reviewService.reject(id, reason);
  }
}
