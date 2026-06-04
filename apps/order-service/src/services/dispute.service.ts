// ============================================================
// HYPERCOMMERCE — Dispute Service
//
// Handles post-purchase dispute lifecycle.
//
// WHY AUTO-ESCALATION?
// Sellers who don't respond in 3 days have disputes auto-escalated
// to CS team. This protects buyers and creates seller accountability.
// Without this, bad sellers stall indefinitely → buyer trust collapses.
//
// WHY SELLER-TIER DEADLINES?
// Enterprise sellers get 5 days (complex supply chains).
// Standard sellers get 3 days.
//
// INTEGRATION POINTS:
// - payment-service: trigger refund via Kafka on RESOLVED_BUYER_FAVOR
// - notification-service: alert seller/buyer on each state change
// - Kafka: dispute.opened, dispute.escalated, dispute.resolved
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { DisputeStatus, ResolutionType } from '../entities/dispute.entity';
import { Dispute } from '../entities/dispute.entity';
import { Order } from '../entities/order.entity';
import type {
  CreateDisputeDto,
  ResolveDisputeDto,
  SellerDisputeResponseDto,
} from '../dto/dispute.dto';

// Days buyer has to open a dispute after delivery
const DISPUTE_WINDOW_DAYS: Partial<Record<string, number>> = {
  electronics: 30,
  luxury: 3,
  default: 7,
};

const SELLER_RESPONSE_DAYS = 3;

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly kafka: KafkaProducerService,
  ) {}

  /**
   * Open a dispute for a delivered order.
   *
   * Validations:
   * 1. Order must belong to the buyer
   * 2. Order must be DELIVERED (not PENDING/CONFIRMED)
   * 3. Within dispute window for the category
   * 4. No existing OPEN or ESCALATED dispute for same order
   */
  async openDispute(orderId: string, buyerId: string, dto: CreateDisputeDto): Promise<Dispute> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items'],
    });

    if (!order) throw new NotFoundException('Order', orderId);
    if (order.userId !== buyerId) {
      throw new ForbiddenException('dispute', 'create', {
        userId: buyerId,
        resourceId: orderId,
      });
    }

    if (!['DELIVERED', 'CONFIRMED'].includes(order.status)) {
      throw new ConflictException(
        `Cannot open dispute for order in status: ${order.status}. Only delivered orders can be disputed.`,
      );
    }

    // Check dispute window
    if (order.completedAt) {
      const windowDays = DISPUTE_WINDOW_DAYS.default!;
      const windowEnd = new Date(order.completedAt);
      windowEnd.setDate(windowEnd.getDate() + windowDays);
      if (new Date() > windowEnd) {
        throw new ConflictException(
          `Dispute window has closed. You had ${windowDays} days from delivery to open a dispute.`,
        );
      }
    }

    // Check no existing open dispute
    const existingDispute = await this.disputeRepo.findOne({
      where: [
        { orderId, status: 'OPEN' },
        { orderId, status: 'AWAITING_SELLER_RESPONSE' },
        { orderId, status: 'ESCALATED' },
      ],
    });
    if (existingDispute) {
      throw new ConflictException(
        `A dispute (${existingDispute.id}) is already open for this order.`,
      );
    }

    // Set seller response deadline
    const respondByDeadline = new Date();
    respondByDeadline.setDate(respondByDeadline.getDate() + SELLER_RESPONSE_DAYS);

    const dispute = this.disputeRepo.create({
      orderId,
      buyerId,
      sellerId: order.sellerId ?? '',
      reason: dto.reason,
      description: dto.description,
      evidenceUrls: dto.evidenceUrls ?? [],
      status: 'AWAITING_SELLER_RESPONSE' as DisputeStatus,
      respondByDeadline,
      requestedRefundAmount: dto.requestedRefundAmount ?? order.totalAmount,
    });

    const saved = await this.disputeRepo.save(dispute);

    // Notify seller + update order status
    await Promise.all([
      this.orderRepo.update(orderId, { status: 'DISPUTED' }),
      this.kafka.publish({
        topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
        partitionKey: orderId,
        value: {
          type: 'DISPUTE_OPENED',
          disputeId: saved.id,
          orderId,
          buyerId,
          sellerId: order.sellerId,
          reason: dto.reason,
          requestedRefundAmount: saved.requestedRefundAmount,
          respondByDeadline: respondByDeadline.toISOString(),
        },
      }),
    ]);

    this.logger.log(
      JSON.stringify({
        event: 'dispute_opened',
        disputeId: saved.id,
        orderId,
        buyerId,
        reason: dto.reason,
        respondByDeadline,
      }),
    );

    return saved;
  }

  /**
   * Seller responds to a dispute.
   * Moves status to AWAITING_BUYER_EVIDENCE if seller provides counter-evidence.
   */
  async sellerRespond(
    disputeId: string,
    sellerId: string,
    dto: SellerDisputeResponseDto,
  ): Promise<Dispute> {
    const dispute = await this.findOrFail(disputeId);

    if (dispute.sellerId !== sellerId) {
      throw new ForbiddenException('dispute', 'respond', { userId: sellerId });
    }

    if (dispute.status !== 'AWAITING_SELLER_RESPONSE') {
      throw new ConflictException(`Cannot respond: dispute is in status '${dispute.status}'`);
    }

    dispute.status = 'AWAITING_BUYER_EVIDENCE';
    const updated = await this.disputeRepo.save(dispute);

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
      partitionKey: dispute.orderId,
      value: {
        type: 'DISPUTE_SELLER_RESPONDED',
        disputeId,
        orderId: dispute.orderId,
        buyerId: dispute.buyerId,
        response: dto.response,
      },
    });

    return updated;
  }

  /**
   * CS agent or auto-policy resolves the dispute.
   * Triggers refund via Kafka if resolved in buyer's favor.
   */
  async resolveDispute(
    disputeId: string,
    resolvedBy: string,
    dto: ResolveDisputeDto,
  ): Promise<Dispute> {
    const dispute = await this.findOrFail(disputeId);

    const isFinal = ['RESOLVED_BUYER_FAVOR', 'RESOLVED_SELLER_FAVOR', 'CLOSED'].includes(
      dispute.status,
    );
    if (isFinal) {
      throw new ConflictException(`Dispute ${disputeId} is already resolved.`);
    }

    let newStatus: DisputeStatus;
    if (dto.resolution === 'NO_ACTION' || dto.resolution === 'WITHDRAWAL') {
      newStatus = 'RESOLVED_SELLER_FAVOR';
    } else {
      newStatus = 'RESOLVED_BUYER_FAVOR';
    }

    const refundAmount =
      dto.resolution === 'FULL_REFUND'
        ? (dispute.requestedRefundAmount ?? 0)
        : (dto.refundAmount ?? 0);

    Object.assign(dispute, {
      status: newStatus,
      resolutionType: dto.resolution as ResolutionType,
      resolvedRefundAmount: refundAmount,
      resolutionNote: dto.note,
      assignedTo: resolvedBy,
      resolvedAt: new Date(),
    });

    const saved = await this.disputeRepo.save(dispute);

    // Trigger refund if buyer wins
    if (newStatus === 'RESOLVED_BUYER_FAVOR' && refundAmount > 0) {
      await this.kafka.publish({
        topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_REFUNDED,
        partitionKey: dispute.orderId,
        value: {
          type: 'DISPUTE_REFUND_REQUESTED',
          disputeId,
          orderId: dispute.orderId,
          amount: refundAmount,
          reason: `Dispute resolved: ${dto.resolution}`,
          resolvedBy,
        },
      });
    }

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
      partitionKey: dispute.orderId,
      value: {
        type: 'DISPUTE_RESOLVED',
        disputeId,
        orderId: dispute.orderId,
        resolution: dto.resolution,
        refundAmount,
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'dispute_resolved',
        disputeId,
        orderId: dispute.orderId,
        resolution: dto.resolution,
        refundAmount,
        resolvedBy,
      }),
    );

    return saved;
  }

  /**
   * Auto-escalate disputes where seller missed the response deadline.
   * Called by a scheduled job (every 30 minutes).
   */
  async escalateOverdueDsiputes(): Promise<number> {
    const overdue = await this.disputeRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: 'AWAITING_SELLER_RESPONSE' })
      .andWhere('d.respondByDeadline < :now', { now: new Date() })
      .getMany();

    if (overdue.length === 0) return 0;

    await this.disputeRepo
      .createQueryBuilder()
      .update(Dispute)
      .set({ status: 'ESCALATED' as DisputeStatus })
      .whereInIds(overdue.map((d) => d.id))
      .execute();

    // Notify CS and buyers
    for (const dispute of overdue) {
      await this.kafka.publish({
        topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
        partitionKey: dispute.orderId,
        value: {
          type: 'DISPUTE_ESCALATED',
          disputeId: dispute.id,
          orderId: dispute.orderId,
          buyerId: dispute.buyerId,
          sellerId: dispute.sellerId,
          reason: 'Seller did not respond within the deadline',
        },
      });
    }

    this.logger.log(JSON.stringify({ event: 'disputes_escalated', count: overdue.length }));

    return overdue.length;
  }

  async getDisputesByOrder(orderId: string): Promise<Dispute[]> {
    return this.disputeRepo.find({ where: { orderId }, order: { createdAt: 'DESC' } });
  }

  async getDisputesByBuyer(buyerId: string, status?: DisputeStatus): Promise<Dispute[]> {
    const qb = this.disputeRepo
      .createQueryBuilder('d')
      .where('d.buyerId = :buyerId', { buyerId })
      .orderBy('d.createdAt', 'DESC');

    if (status) qb.andWhere('d.status = :status', { status });

    return qb.getMany();
  }

  // ── Private ───────────────────────────────────────────────

  private async findOrFail(disputeId: string): Promise<Dispute> {
    const dispute = await this.disputeRepo.findOne({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute', disputeId);
    return dispute;
  }
}
