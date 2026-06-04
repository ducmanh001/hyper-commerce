// apps/order-service/src/queries/handlers/order-query.handler.ts
// Handles GetOrderQuery and ListOrdersQuery — read-only operations.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GetOrderQuery, ListOrdersQuery } from '../order.queries';
import type { OrderRepository } from '../../repositories/order.repository';

@Injectable()
export class OrderQueryHandler {
  private readonly logger = new Logger(OrderQueryHandler.name);

  constructor(private readonly repo: OrderRepository) {}

  async getOrder(query: GetOrderQuery) {
    const order = await this.repo.findById(query.orderId);

    if (!order) {
      throw new NotFoundException(`Order ${query.orderId} not found`);
    }

    // Ownership check
    if (query.requestingUserId && order.userId !== query.requestingUserId) {
      // Return 404 instead of 403 to avoid leaking existence info
      throw new NotFoundException(`Order ${query.orderId} not found`);
    }

    return order;
  }

  async listOrders(query: ListOrdersQuery) {
    const result = await this.repo.findByUserId(query.userId, {
      cursor: (query as unknown as Record<string, unknown>).cursor as string | undefined,
      limit: query.limit ?? 20,
    });

    return {
      orders: result.items,
      total: result.total,
      nextCursor: result.nextCursor,
      hasMore: result.nextCursor !== null,
    };
  }
}
