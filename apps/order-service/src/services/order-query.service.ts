import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderRepository, PaginatedOrders } from '../repositories/order.repository';
import { OrderResponseDto } from '../dto/order-response.dto';
import type { OrderItemRepository } from '../repositories/order-item.repository';
import type { CursorPaginationDto } from '@hypercommerce/common';

/**
 * OrderQueryService — handles all READ operations.
 *
 * Separation from OrderService (which handles writes) allows:
 * - CQRS pattern: reads can go to read replica
 * - Independent scaling of read vs write paths
 * - Cleaner test doubles (mock reads separately from write side-effects)
 */
@Injectable()
export class OrderQueryService {
  private readonly logger = new Logger(OrderQueryService.name);

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly orderItemRepo: OrderItemRepository,
  ) {}

  async findOneOrFail(id: string, userId: string): Promise<OrderResponseDto> {
    const order = await this.orderRepo.findByIdWithItems(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    // Non-admin can only see their own orders
    if (order.userId !== userId) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return OrderResponseDto.fromEntity(order, order.items ?? []);
  }

  async findByUserId(
    userId: string,
    pagination: CursorPaginationDto,
  ): Promise<{ items: OrderResponseDto[]; nextCursor: string | null; total: number }> {
    const result: PaginatedOrders = await this.orderRepo.findByUserId(userId, pagination);
    return {
      items: result.items.map((o) => OrderResponseDto.fromEntity(o, o.items ?? [])),
      nextCursor: result.nextCursor,
      total: result.total,
    };
  }

  async findBySellerId(
    sellerId: string,
    pagination: CursorPaginationDto,
  ): Promise<{ items: OrderResponseDto[]; nextCursor: string | null; total: number }> {
    const result: PaginatedOrders = await this.orderRepo.findBySellerId(sellerId, pagination);
    return {
      items: result.items.map((o) => OrderResponseDto.fromEntity(o, o.items ?? [])),
      nextCursor: result.nextCursor,
      total: result.total,
    };
  }

  async getStats(from: string, to: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();
    return this.orderRepo.getStats(fromDate, toDate);
  }
}
