import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { StockWaitlist, WaitlistType, WaitlistStatus } from '../entities/stock-waitlist.entity';

const WAITLIST_EXPIRY_DAYS = 30;
/** Max users to notify per restock event (prevent notification spam) */
const NOTIFY_BATCH_SIZE = 500;

export interface JoinWaitlistDto {
  userId: string;
  productId: string;
  variantId?: string;
  type?: WaitlistType;
  targetPrice?: number;
  autoOrder?: boolean;
  quantity?: number;
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(StockWaitlist)
    private readonly waitlistRepo: Repository<StockWaitlist>,
    private readonly kafka: KafkaProducerService,
  ) {}

  // ── Join / leave ───────────────────────────────────────────

  async join(dto: JoinWaitlistDto): Promise<{ entry: StockWaitlist; position: number }> {
    // Check for existing active entry
    const existing = await this.waitlistRepo.findOne({
      where: {
        userId: dto.userId,
        productId: dto.productId,
        variantId: dto.variantId,
        type: dto.type ?? WaitlistType.BACK_IN_STOCK,
        status: WaitlistStatus.WAITING,
      },
    });
    if (existing) throw new ConflictException('Already in waitlist for this product');

    // Count how many are already waiting (determines position)
    const position = await this.waitlistRepo.count({
      where: {
        productId: dto.productId,
        variantId: dto.variantId,
        type: dto.type ?? WaitlistType.BACK_IN_STOCK,
        status: WaitlistStatus.WAITING,
      },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + WAITLIST_EXPIRY_DAYS);

    const entry = await this.waitlistRepo.save(
      this.waitlistRepo.create({
        userId: dto.userId,
        productId: dto.productId,
        variantId: dto.variantId,
        type: dto.type ?? WaitlistType.BACK_IN_STOCK,
        targetPrice: dto.targetPrice,
        autoOrder: dto.autoOrder ?? false,
        quantity: dto.quantity ?? 1,
        position: position + 1,
        expiresAt,
      }),
    );

    this.logger.log(
      `User ${dto.userId} joined waitlist for product ${dto.productId} at position ${entry.position}`,
    );
    return { entry, position: entry.position };
  }

  async leave(userId: string, productId: string, variantId?: string): Promise<void> {
    const entry = await this.waitlistRepo.findOne({
      where: { userId, productId, variantId, status: WaitlistStatus.WAITING },
    });
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    await this.waitlistRepo.update(entry.id, { status: WaitlistStatus.CANCELLED });
  }

  async getPosition(
    userId: string,
    productId: string,
    variantId?: string,
  ): Promise<{ position: number; totalWaiting: number } | null> {
    const entry = await this.waitlistRepo.findOne({
      where: { userId, productId, variantId, status: WaitlistStatus.WAITING },
    });
    if (!entry) return null;

    const totalWaiting = await this.waitlistRepo.count({
      where: { productId, variantId, status: WaitlistStatus.WAITING },
    });

    return { position: entry.position, totalWaiting };
  }

  async getUserWaitlist(userId: string): Promise<StockWaitlist[]> {
    return this.waitlistRepo.find({
      where: { userId, status: WaitlistStatus.WAITING },
      order: { createdAt: 'DESC' },
    });
  }

  // ── Called when stock is restocked (by InventoryService) ──

  async processRestock(
    productId: string,
    variantId: string | undefined,
    stockAdded: number,
  ): Promise<void> {
    const waitingEntries = await this.waitlistRepo.find({
      where: {
        productId,
        variantId,
        type: WaitlistType.BACK_IN_STOCK,
        status: WaitlistStatus.WAITING,
      },
      order: { position: 'ASC' },
      take: NOTIFY_BATCH_SIZE,
    });

    if (waitingEntries.length === 0) return;

    this.logger.log(
      `Processing restock: ${stockAdded} units for ${productId}, notifying ${waitingEntries.length} users`,
    );

    // Notify users in FIFO order
    for (const entry of waitingEntries) {
      await this.waitlistRepo.update(entry.id, {
        status: WaitlistStatus.NOTIFIED,
        notifiedAt: new Date(),
      });

      await this.kafka.publish({
        topic: 'waitlist.restock_notification',
        partitionKey: entry.userId,
        value: {
          userId: entry.userId,
          productId: entry.productId,
          variantId: entry.variantId,
          type: 'back_in_stock',
          autoOrder: entry.autoOrder,
          quantity: entry.quantity,
          waitlistId: entry.id,
          correlationId: entry.id,
        },
      });
    }
  }

  // ── Called when price drops (by inventory/product service) ─

  async processPriceDrop(
    productId: string,
    variantId: string | undefined,
    newPrice: number,
  ): Promise<void> {
    // Find users waiting for this price or lower
    const eligible = await this.waitlistRepo
      .createQueryBuilder('w')
      .where('w.productId = :productId', { productId })
      .andWhere('w.variantId IS NOT DISTINCT FROM :variantId', { variantId: variantId ?? null })
      .andWhere('w.type = :type', { type: WaitlistType.PRICE_DROP })
      .andWhere('w.status = :status', { status: WaitlistStatus.WAITING })
      .andWhere('w.targetPrice >= :newPrice', { newPrice })
      .orderBy('w.position', 'ASC')
      .take(NOTIFY_BATCH_SIZE)
      .getMany();

    for (const entry of eligible) {
      await this.waitlistRepo.update(entry.id, {
        status: WaitlistStatus.NOTIFIED,
        notifiedAt: new Date(),
      });
      await this.kafka.publish({
        topic: 'waitlist.price_drop_notification',
        partitionKey: entry.userId,
        value: {
          userId: entry.userId,
          productId: entry.productId,
          variantId: entry.variantId,
          newPrice,
          targetPrice: entry.targetPrice,
          type: 'price_drop',
          correlationId: entry.id,
        },
      });
    }

    if (eligible.length > 0) {
      this.logger.log(
        `Price drop: ${eligible.length} users notified for product ${productId} at ${newPrice}₫`,
      );
    }
  }

  // ── Expire old entries (daily cron) ────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async expireOldEntries(): Promise<void> {
    const result = await this.waitlistRepo
      .createQueryBuilder()
      .update(StockWaitlist)
      .set({ status: WaitlistStatus.EXPIRED })
      .where('status = :status', { status: WaitlistStatus.WAITING })
      .andWhere('"expiresAt" < NOW()')
      .execute();

    if (result.affected) {
      this.logger.log(`Expired ${result.affected} waitlist entries`);
    }
  }
}
