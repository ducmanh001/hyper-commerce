import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, DataSource } from 'typeorm';
import type { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { firstValueFrom } from 'rxjs';
import type { ConfigService } from '@nestjs/config';
import { Review, ReviewStatus } from './entities/review.entity';
import { ReviewHelpful } from './entities/review-helpful.entity';
import type { RedisClientService } from '@hypercommerce/redis';
import { QUEUE_NAMES, JOB_NAMES, JOB_DEFAULT_OPTIONS } from '@hypercommerce/queue';

export interface CreateReviewDto {
  userId: string;
  orderId: string;
  productId: string;
  sellerId: string;
  rating: number;
  title?: string;
  content?: string;
  images?: string[];
}

export interface UpdateSellerReplyDto {
  sellerId: string;
  reviewId: string;
  reply: string;
}

export interface ListReviewsQuery {
  productId?: string;
  sellerId?: string;
  userId?: string;
  status?: ReviewStatus;
  minRating?: number;
  maxRating?: number;
  page?: number;
  limit?: number;
  sort?: 'newest' | 'helpful' | 'rating_asc' | 'rating_desc';
}

export interface ProductRatingStats {
  productId: string;
  averageRating: number;
  totalCount: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

const RATING_CACHE_TTL = 300; // 5 minutes

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewHelpful)
    private readonly helpfulRepo: Repository<ReviewHelpful>,
    private readonly dataSource: DataSource,
    private readonly httpService: HttpService,
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.REVIEW_PROCESSING)
    private readonly reviewQueue: Queue,
  ) {}

  // ── Create review ──────────────────────────────────────────

  async create(dto: CreateReviewDto): Promise<Review> {
    // 1. Validate rating range
    if (dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    // 2. Verify it's a delivered order (no gaming the system with pending orders)
    const isVerified = await this.verifyDeliveredOrder(dto.orderId, dto.userId, dto.productId);

    // 3. Check duplicate (constraint enforced at DB level too, but give friendly error)
    const existing = await this.reviewRepo.findOne({
      where: { userId: dto.userId, orderId: dto.orderId, productId: dto.productId },
    });
    if (existing)
      throw new ConflictException('You have already reviewed this product for this order');

    // 4. Save review as PENDING — AI moderation runs async
    const review = await this.reviewRepo.save(
      this.reviewRepo.create({
        ...dto,
        images: dto.images ?? [],
        status: ReviewStatus.PENDING,
        verifiedPurchase: isVerified,
      }),
    );

    // 5. Enqueue async moderation + downstream events
    await this.reviewQueue.add(
      JOB_NAMES.PROCESS_REVIEW,
      { reviewId: review.id },
      JOB_DEFAULT_OPTIONS.NON_CRITICAL,
    );

    this.logger.log(
      `Review ${review.id} created for product ${dto.productId} by user ${dto.userId}`,
    );
    return review;
  }

  // ── List reviews ───────────────────────────────────────────

  async list(
    query: ListReviewsQuery,
  ): Promise<{ items: Review[]; total: number; stats?: ProductRatingStats }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const qb = this.reviewRepo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: query.status ?? ReviewStatus.APPROVED });

    if (query.productId) qb.andWhere('r.productId = :productId', { productId: query.productId });
    if (query.sellerId) qb.andWhere('r.sellerId = :sellerId', { sellerId: query.sellerId });
    if (query.userId) qb.andWhere('r.userId = :userId', { userId: query.userId });
    if (query.minRating) qb.andWhere('r.rating >= :min', { min: query.minRating });
    if (query.maxRating) qb.andWhere('r.rating <= :max', { max: query.maxRating });

    switch (query.sort) {
      case 'helpful':
        qb.orderBy('r.helpfulCount', 'DESC');
        break;
      case 'rating_asc':
        qb.orderBy('r.rating', 'ASC');
        break;
      case 'rating_desc':
        qb.orderBy('r.rating', 'DESC');
        break;
      default:
        qb.orderBy('r.createdAt', 'DESC');
    }

    const [items, total] = await qb.skip(offset).take(limit).getManyAndCount();

    const stats = query.productId ? await this.getProductRatingStats(query.productId) : undefined;

    return { items, total, stats };
  }

  async findById(id: string): Promise<Review> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException(`Review ${id} not found`);
    return review;
  }

  // ── Helpful votes ──────────────────────────────────────────

  async markHelpful(reviewId: string, userId: string): Promise<{ helpfulCount: number }> {
    const review = await this.findById(reviewId);
    if (review.userId === userId)
      throw new BadRequestException('Cannot mark your own review as helpful');
    if (review.status !== ReviewStatus.APPROVED)
      throw new BadRequestException('Review is not published');

    const existing = await this.helpfulRepo.findOne({ where: { reviewId, userId } });
    if (existing) return { helpfulCount: review.helpfulCount }; // idempotent

    await this.dataSource.transaction(async (manager) => {
      await manager.save(ReviewHelpful, manager.create(ReviewHelpful, { reviewId, userId }));
      await manager.increment(Review, { id: reviewId }, 'helpfulCount', 1);
    });

    const updated = await this.findById(reviewId);
    return { helpfulCount: updated.helpfulCount };
  }

  async unmarkHelpful(reviewId: string, userId: string): Promise<{ helpfulCount: number }> {
    const deleted = await this.helpfulRepo.delete({ reviewId, userId });
    if (deleted.affected) {
      await this.reviewRepo.decrement({ id: reviewId }, 'helpfulCount', 1);
    }
    const updated = await this.findById(reviewId);
    return { helpfulCount: updated.helpfulCount };
  }

  // ── Seller reply ───────────────────────────────────────────

  async addSellerReply(dto: UpdateSellerReplyDto): Promise<Review> {
    const review = await this.findById(dto.reviewId);
    if (review.sellerId !== dto.sellerId) throw new ForbiddenException('Not your product review');
    if (review.status !== ReviewStatus.APPROVED)
      throw new BadRequestException('Can only reply to approved reviews');
    if (review.sellerReply)
      throw new ConflictException('Reply already exists — use update endpoint');

    await this.reviewRepo.update(dto.reviewId, {
      sellerReply: dto.reply.substring(0, 500), // max 500 chars
      sellerRepliedAt: new Date(),
    });

    return this.findById(dto.reviewId);
  }

  async updateSellerReply(dto: UpdateSellerReplyDto): Promise<Review> {
    const review = await this.findById(dto.reviewId);
    if (review.sellerId !== dto.sellerId) throw new ForbiddenException('Not your product review');

    await this.reviewRepo.update(dto.reviewId, {
      sellerReply: dto.reply.substring(0, 500),
      sellerRepliedAt: new Date(),
    });
    return this.findById(dto.reviewId);
  }

  // ── Admin moderation ───────────────────────────────────────

  async approve(reviewId: string): Promise<Review> {
    const review = await this.findById(reviewId);
    if (review.status === ReviewStatus.APPROVED) return review;

    await this.reviewRepo.update(reviewId, { status: ReviewStatus.APPROVED });

    // Trigger rating recalculation
    await this.reviewQueue.add(
      JOB_NAMES.UPDATE_PRODUCT_RATING,
      { productId: review.productId },
      JOB_DEFAULT_OPTIONS.BEST_EFFORT,
    );

    return this.findById(reviewId);
  }

  async reject(reviewId: string, reason: string): Promise<Review> {
    await this.reviewRepo.update(reviewId, {
      status: ReviewStatus.REJECTED,
      rejectionReason: reason,
    });

    // Notify buyer their review was rejected
    await this.reviewQueue.add(
      JOB_NAMES.NOTIFY_SELLER_REVIEW,
      { reviewId, action: 'rejected', reason },
      JOB_DEFAULT_OPTIONS.NON_CRITICAL,
    );

    return this.findById(reviewId);
  }

  async listPendingAdmin(page = 1, limit = 50): Promise<{ items: Review[]; total: number }> {
    const [items, total] = await this.reviewRepo.findAndCount({
      where: [{ status: ReviewStatus.PENDING }, { status: ReviewStatus.FLAGGED }],
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  // ── Rating stats (Redis-cached) ────────────────────────────

  async getProductRatingStats(productId: string): Promise<ProductRatingStats> {
    const cacheKey = `product:rating:${productId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ProductRatingStats;

    return this.recalculateProductRating(productId);
  }

  async recalculateProductRating(productId: string): Promise<ProductRatingStats> {
    const cacheKey = `product:rating:${productId}`;
    const rows = await this.reviewRepo
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('r.productId = :productId', { productId })
      .andWhere('r.status = :status', { status: ReviewStatus.APPROVED })
      .groupBy('r.rating')
      .getRawMany<{ rating: string; count: string }>();

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    let totalCount = 0;
    let ratingSum = 0;

    for (const row of rows) {
      const r = parseInt(row.rating, 10) as 1 | 2 | 3 | 4 | 5;
      const c = parseInt(row.count, 10);
      distribution[r] = c;
      totalCount += c;
      ratingSum += r * c;
    }

    const stats: ProductRatingStats = {
      productId,
      averageRating: totalCount > 0 ? Math.round((ratingSum / totalCount) * 10) / 10 : 0,
      totalCount,
      distribution,
    };

    await this.redis.set(cacheKey, JSON.stringify(stats), RATING_CACHE_TTL);
    return stats;
  }

  // ── Private: verify purchase ────────────────────────────────

  private async verifyDeliveredOrder(
    orderId: string,
    userId: string,
    productId: string,
  ): Promise<boolean> {
    const orderServiceUrl =
      this.config.get<string>('ORDER_SERVICE_URL') ?? 'http://order-service:3003';
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${orderServiceUrl}/orders/${orderId}/verify-review`, {
          params: { userId, productId },
          timeout: 3000,
        }),
      );
      return (response.data as { delivered: boolean }).delivered === true;
    } catch {
      // If order-service is down, allow review (fail open — verify asynchronously)
      this.logger.warn(
        `Could not verify order ${orderId} — allowing review with unverified status`,
      );
      return false;
    }
  }
}
