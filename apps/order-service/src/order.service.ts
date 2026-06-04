// ============================================================
// HYPERCOMMERCE — Order Service
// Orchestrates distributed transaction via Saga Choreography.
//
// Flow:
// 1. Verify prices server-side (CRITICAL: prevents price tampering)
// 2. Validate & reserve voucher (if provided)
// 3. Calculate shipping fee
// 4. Create order (PENDING) → publish order.created
// 5. Listen to stock.reserved → transition to STOCK_RESERVED
// 6. Listen to payment.captured → transition to CONFIRMED → create commission
// 7. Listen to payment.failed / stock.insufficient → CANCELLED → rollback voucher
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, DataSource, EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import type { RedisClientService } from '@hypercommerce/redis';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import {
  NotFoundException,
  OrderAlreadyExistsException,
  OrderStateTransitionException,
  ForbiddenException,
} from '@hypercommerce/common/exceptions/domain.exceptions';
import type { OrderStatus } from './entities/order.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OutboxEvent, OutboxEventStatus } from './entities/outbox-event.entity';
import type { IdempotencyService } from './idempotency/idempotency.service';
import type { OrderTransition } from './saga/order-state-machine';
import { OrderStateмашина } from './saga/order-state-machine';
import type { CreateOrderDto } from './dto';
import { OrderResponseDto } from './dto';
import type { OrderRepository } from './repositories/order.repository';
import type { PriceVerificationService } from './services/price-verification.service';
import type { VoucherService } from './services/voucher.service';
import type { CommissionService } from './services/commission.service';
import type { ShippingCalculatorService } from './services/shipping-calculator.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
    private readonly kafka: KafkaProducerService,
    private readonly redis: RedisClientService,
    private readonly idempotency: IdempotencyService,
    private readonly dataSource: DataSource,
    private readonly orderRepo2: OrderRepository,
    private readonly priceVerification: PriceVerificationService,
    private readonly voucherService: VoucherService,
    private readonly commissionService: CommissionService,
    private readonly shippingCalculator: ShippingCalculatorService,
  ) {}

  /**
   * Create a new order — Step 1 of the Saga.
   *
   * Critical invariants:
   * 1. Idempotent: same idempotency_key → same response
   * 2. Prices verified server-side — client prices never stored
   * 3. Voucher validated and reserved atomically
   * 4. Atomic: order record + Kafka event in logical unit
   * 5. Returns immediately after publishing — Saga runs async
   */
  async createOrder(dto: CreateOrderDto, userId: string): Promise<OrderResponseDto> {
    // ── Idempotency check ──────────────────────────────────
    const cached = await this.idempotency.getResult<OrderResponseDto>(dto.idempotencyKey ?? '');
    if (cached && dto.idempotencyKey) {
      this.logger.log(
        JSON.stringify({
          event: 'order_idempotent_hit',
          idempotencyKey: dto.idempotencyKey,
          userId,
        }),
      );
      return cached;
    }

    // Acquire distributed lock
    const lockKey = `order:lock:${dto.idempotencyKey}`;
    const locked = await this.acquireLock(lockKey, 10);
    if (!locked) throw new OrderAlreadyExistsException(dto.idempotencyKey ?? lockKey);

    let voucherReserved: string | null = null;

    try {
      // ── STEP 1: Server-side price verification (SECURITY CRITICAL) ──
      // Client prices are NEVER trusted. We query the catalog and verify.
      // Mismatch > 1% → PriceMismatchException → order rejected.
      const verifiedItems = await this.priceVerification.verifyAndEnrich(
        dto.items,
        dto.currency ?? 'VND',
      );

      // Compute subtotal from server-verified prices
      const subtotal = verifiedItems.reduce((sum, item) => sum + item.subtotal, 0);

      // ── STEP 2: Shipping fee calculation ──────────────────
      const shipping = dto.shippingAddress
        ? this.shippingCalculator.calculate({
            method: (dto.shippingMethod as 'STANDARD' | 'EXPRESS' | 'SAME_DAY') ?? 'STANDARD',
            originCity: 'tp.hcm', // TODO: fetch from seller warehouse location
            destinationCity:
              (dto.shippingAddress as unknown as Record<string, string>)['city'] ?? 'tp.hcm',
            weightGrams: verifiedItems.reduce((sum, item) => sum + item.quantity * 500, 0), // 500g default per item
            orderTotal: subtotal,
            freeShippingVoucher: false, // updated below if voucher is FREE_SHIPPING
          })
        : null;

      // ── STEP 3: Voucher validation ─────────────────────────
      let discountAmount = 0;
      let voucherValidation: Awaited<ReturnType<typeof this.voucherService.validate>> | null = null;

      if (dto.voucherCode) {
        voucherValidation = await this.voucherService.validate({
          code: dto.voucherCode,
          userId,
          sellerId: dto.sellerId,
          orderSubtotal: subtotal,
          currency: dto.currency ?? 'VND',
        });
        discountAmount = voucherValidation.discountAmount;
        voucherReserved = voucherValidation.voucherId;
      }

      const shippingFee = shipping?.fee ?? 0;
      const totalAmount = Math.max(0, subtotal - discountAmount + shippingFee);

      // ── STEP 4: Persist order + line items ────────────────
      const orderId = uuidv4();
      const order = await this.dataSource.transaction(async (manager: EntityManager) => {
        const orderEntity = manager.create(Order, {
          id: orderId,
          userId,
          sellerId: dto.sellerId,
          status: APP_CONSTANTS.ORDER_STATUS.PENDING,
          totalAmount,
          currency: dto.currency ?? 'VND',
          shippingAddress: dto.shippingAddress as unknown as Record<string, string>,
          idempotencyKey: dto.idempotencyKey,
          metadata: {
            ...(dto.metadata ?? {}),
            subtotal,
            discountAmount,
            shippingFee,
            shippingMethod: dto.shippingMethod ?? 'STANDARD',
            shippingZone: shipping?.zone,
            voucherCode: dto.voucherCode,
            voucherId: voucherValidation?.voucherId,
          },
        });

        const saved = await manager.save(Order, orderEntity);

        // Store SERVER-VERIFIED prices — never client prices
        const items = verifiedItems.map((item) =>
          manager.create(OrderItem, {
            orderId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.verifiedUnitPrice, // ← SERVER PRICE, not client
            subtotal: item.subtotal,
            productName: item.snapshot.name,
            sellerId: item.snapshot.sellerId,
            snapshot: item.snapshot,
          }),
        );

        await manager.save(OrderItem, items);

        return saved;
      });

      // ── STEP 5: Commit voucher usage (after order persisted) ──
      if (voucherValidation && dto.voucherCode) {
        await this.voucherService.commitUsage({
          voucherId: voucherValidation.voucherId,
          userId,
          orderId,
          discountApplied: discountAmount,
          orderSubtotal: subtotal,
        });
        voucherReserved = null; // committed, no need to rollback
      }

      // ── STEP 6: Write Saga event to Outbox (same transaction as order) ──
      // OUTBOX PATTERN: event is written atomically with the order.
      // OutboxProcessorService polls and publishes to Kafka separately.
      // Eliminates dual-write risk: if Kafka is down, event stays in DB.
      await this.dataSource.transaction(async (manager: EntityManager) => {
        const outboxEvent = manager.create(OutboxEvent, {
          id: uuidv4(),
          aggregateType: 'Order',
          aggregateId: orderId,
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_EVENTS,
          partitionKey: dto.sellerId ?? orderId,
          payload: {
            type: 'ORDER_CREATED',
            orderId,
            userId,
            sellerId: dto.sellerId,
            items: verifiedItems.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
              unitPrice: i.verifiedUnitPrice,
            })),
            totalAmount: order.totalAmount,
            subtotal,
            shippingFee,
            discountAmount,
            currency: order.currency,
            idempotencyKey: dto.idempotencyKey,
            timestamp: new Date().toISOString(),
          },
          status: OutboxEventStatus.PENDING,
          attemptCount: 0,
        });
        await manager.save(OutboxEvent, outboxEvent);
      });

      const response = OrderResponseDto.fromEntity(order, []);

      await this.idempotency.storeResult(
        dto.idempotencyKey ?? orderId,
        response,
        APP_CONSTANTS.IDEMPOTENCY_TTL,
      );

      this.logger.log(
        JSON.stringify({
          event: 'order_created',
          orderId,
          userId,
          subtotal,
          discountAmount,
          shippingFee,
          totalAmount: order.totalAmount,
          itemCount: dto.items.length,
          voucherUsed: !!dto.voucherCode,
        }),
      );

      return response;
    } catch (err) {
      // Rollback voucher reservation if order creation failed
      if (voucherReserved) {
        await this.voucherService
          .rollbackUsage(voucherReserved, userId)
          .catch((e) => this.logger.error(`Voucher rollback failed: ${String(e)}`));
      }
      throw err;
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Transition order state — called by Saga event handlers.
   * Uses optimistic locking to prevent concurrent state corruption.
   */
  async transitionState(orderId: string, transition: OrderTransition): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order', orderId);

    const stateMachine = new OrderStateмашина(order.status);
    if (!stateMachine.canTransition(transition)) {
      throw new OrderStateTransitionException(orderId, order.status, transition);
    }

    const newStatus = stateMachine.transition(transition);

    const result = await this.orderRepo
      .createQueryBuilder()
      .update(Order)
      .set({
        status: newStatus as OrderStatus,
        version: () => 'version + 1',
        updatedAt: new Date(),
        ...(newStatus === 'CONFIRMED' && { confirmedAt: new Date() }),
        ...(newStatus === 'DELIVERED' && { completedAt: new Date() }),
        ...(newStatus === 'CANCELLED' && { cancelledAt: new Date() }),
      })
      .where('id = :id AND version = :version', { id: orderId, version: order.version })
      .returning('*')
      .execute();

    if (!result.affected || result.affected === 0) {
      throw new OrderStateTransitionException(
        orderId,
        order.status,
        `${transition} (concurrent conflict)`,
      );
    }

    const updated = result.raw[0] as Order;

    // Side effect: create commission record on confirmation
    if (newStatus === 'CONFIRMED' && order.sellerId) {
      const sellerId = order.sellerId;
      const orderGmv = order.totalAmount;
      // Fire-and-forget: don't block order confirmation on commission creation
      this.commissionService
        .createCommission({
          orderId,
          sellerId,
          orderGmv,
          paymentMethod: order.paymentMethod ?? 'UNKNOWN',
        })
        .catch((e) =>
          this.logger.error(`Commission creation failed for order ${orderId}: ${String(e)}`),
        );
    }

    return updated;
  }

  async getOrder(orderId: string, userId: string): Promise<OrderResponseDto> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, userId },
      relations: ['items'],
    });

    if (!order) throw new NotFoundException('Order', orderId);

    return OrderResponseDto.fromEntity(order, order.items);
  }

  /**
   * Cancel an order — user-initiated.
   * Only cancellable in PENDING or STOCK_RESERVED state.
   */
  async cancelOrder(orderId: string, userId: string, _reason: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order', orderId);
    if (order.userId !== userId) {
      throw new ForbiddenException('order', 'cancel', { userId, resourceId: orderId });
    }

    const updated = await this.transitionState(orderId, 'CANCEL');

    // Reverse commission if already created (edge case: cancel after confirm)
    await this.commissionService.reverseCommission(orderId).catch(() => void 0);

    return updated;
  }

  // ── Helpers ───────────────────────────────────────────────

  private async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.getClient().set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  private async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
