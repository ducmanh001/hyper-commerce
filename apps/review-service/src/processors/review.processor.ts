import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { QUEUE_NAMES, JOB_NAMES } from '@hypercommerce/queue';
import { Review, ReviewStatus } from '../entities/review.entity';
import type { ReviewService } from '../review.service';
import type { ContentModerationAgentService } from '@app/ai-agents';
import { AgentType, TaskPriority } from '@app/ai-agents';
import { v4 as uuid } from 'uuid';

@Processor(QUEUE_NAMES.REVIEW_PROCESSING)
export class ReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewProcessor.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    private readonly reviewService: ReviewService,
    private readonly kafka: KafkaProducerService,
    private readonly moderationAgent: ContentModerationAgentService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.PROCESS_REVIEW:
        await this.processReview(job.data as { reviewId: string });
        break;
      case JOB_NAMES.UPDATE_PRODUCT_RATING:
        await this.updateProductRating(job.data as { productId: string });
        break;
      case JOB_NAMES.NOTIFY_SELLER_REVIEW:
        await this.notifySeller(job.data as { reviewId: string; action: string; reason?: string });
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  // ── PROCESS_REVIEW: Moderate → Approve/Flag → Publish events ──

  private async processReview(data: { reviewId: string }): Promise<void> {
    const review = await this.reviewRepo.findOne({ where: { id: data.reviewId } });
    if (!review) {
      this.logger.warn(`Review ${data.reviewId} not found`);
      return;
    }

    // 1. Run ContentModerationAgent
    const moderationResult = await this.moderationAgent.moderate({
      taskId: uuid(),
      type: AgentType.MODERATION,
      priority: TaskPriority.NORMAL,
      input: {
        contentId: review.id,
        contentType: 'review',
        text: [review.title, review.content].filter(Boolean).join(' '),
        language: 'auto',
      },
      correlationId: review.id,
      createdAt: new Date().toISOString(),
      timeoutMs: 5000,
      retryCount: 0,
    });

    const output = moderationResult.output;
    const newStatus = !output
      ? ReviewStatus.FLAGGED
      : output.decision === 'REJECTED'
        ? ReviewStatus.REJECTED
        : output.decision === 'FLAGGED'
          ? ReviewStatus.FLAGGED
          : ReviewStatus.APPROVED;

    await this.reviewRepo.update(review.id, {
      status: newStatus,
      moderationScore: output?.toxicityScore,
      rejectionReason:
        newStatus === ReviewStatus.REJECTED ? output?.categories?.join(', ') : undefined,
    });

    this.logger.log(
      `Review ${review.id} moderation: ${newStatus} (score=${output?.toxicityScore ?? 'n/a'})`,
    );

    if (newStatus === ReviewStatus.APPROVED) {
      await this.onReviewApproved(review);
    } else if (newStatus === ReviewStatus.REJECTED) {
      await this.onReviewRejected(review, output?.categories?.join(', ') ?? 'policy_violation');
    }
    // FLAGGED → waits for human admin review
  }

  private async onReviewApproved(review: Review): Promise<void> {
    // Update product rating cache
    const stats = await this.reviewService.recalculateProductRating(review.productId);

    // Kafka: review.published → search-service, notification-service, analytics
    await this.kafka.publish({
      topic: 'review.published',
      partitionKey: review.productId,
      value: {
        eventId: uuid(),
        eventType: 'REVIEW_PUBLISHED',
        occurredAt: new Date().toISOString(),
        traceId: uuid(),
        version: 1,
        reviewId: review.id,
        productId: review.productId,
        sellerId: review.sellerId,
        rating: review.rating,
        newAverageRating: stats.averageRating,
        totalReviewCount: stats.totalCount,
      },
    });

    // Kafka: notify seller
    await this.kafka.publish({
      topic: 'review.seller_notification',
      partitionKey: review.sellerId,
      value: {
        eventId: uuid(),
        eventType: 'REVIEW_SELLER_NOTIFICATION',
        occurredAt: new Date().toISOString(),
        traceId: uuid(),
        version: 1,
        sellerId: review.sellerId,
        reviewId: review.id,
        productId: review.productId,
        rating: review.rating,
        action: 'new_review',
      },
    });
  }

  private async onReviewRejected(review: Review, reason: string): Promise<void> {
    await this.kafka.publish({
      topic: 'review.rejected',
      partitionKey: review.userId,
      value: {
        eventId: uuid(),
        eventType: 'REVIEW_REJECTED',
        occurredAt: new Date().toISOString(),
        traceId: uuid(),
        version: 1,
        reviewId: review.id,
        userId: review.userId,
        productId: review.productId,
        reason,
      },
    });
  }

  // ── UPDATE_PRODUCT_RATING: Recalculate and cache ────────────

  private async updateProductRating(data: { productId: string }): Promise<void> {
    const stats = await this.reviewService.recalculateProductRating(data.productId);
    this.logger.debug(
      `Product ${data.productId} rating updated: ${stats.averageRating} (${stats.totalCount} reviews)`,
    );

    // Kafka: search-service will re-index product with new rating
    await this.kafka.publish({
      topic: 'review.rating_updated',
      partitionKey: data.productId,
      value: {
        eventId: uuid(),
        eventType: 'REVIEW_RATING_UPDATED',
        occurredAt: new Date().toISOString(),
        traceId: uuid(),
        version: 1,
        productId: data.productId,
        averageRating: stats.averageRating,
        totalCount: stats.totalCount,
      },
    });
  }

  // ── NOTIFY_SELLER_REVIEW ─────────────────────────────────────

  private async notifySeller(data: {
    reviewId: string;
    action: string;
    reason?: string;
  }): Promise<void> {
    const review = await this.reviewRepo.findOne({ where: { id: data.reviewId } });
    if (!review) return;

    await this.kafka.publish({
      topic: 'notification.requested',
      partitionKey: review.sellerId,
      value: {
        eventId: uuid(),
        eventType: 'NOTIFICATION_REQUESTED',
        occurredAt: new Date().toISOString(),
        traceId: uuid(),
        version: 1,
        userId: review.sellerId,
        notificationType: `review_${data.action}`,
        channels: ['push', 'in_app'],
        data: {
          reviewId: review.id,
          productId: review.productId,
          rating: review.rating,
          reason: data.reason,
        },
        priority: 'NORMAL',
      },
    });
  }
}
