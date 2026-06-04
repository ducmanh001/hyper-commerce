// apps/order-service/src/grpc/order.grpc.controller.ts
// Exposes OrderService via gRPC transport for internal service-to-service calls.
// HTTP REST is in order.controller.ts (for client-facing API gateway calls).

import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from '@hypercommerce/grpc';
import type { OrderQueryHandler } from '../queries/handlers/order-query.handler';
import type { CancelOrderHandler } from '../commands/handlers/cancel-order.handler';
import { GetOrderQuery, ListOrdersQuery } from '../queries/order.queries';
import { CancelOrderCommand } from '../commands/cancel-order.command';

interface GetOrderRequest {
  orderId: string;
}

interface GetOrderBatchRequest {
  orderIds: string[];
}

interface GetOrdersByUserRequest {
  userId: string;
  page: number;
  pageSize: number;
  statusFilter?: string;
}

interface CancelOrderRequest {
  orderId: string;
  userId: string;
  reason: string;
}

@Controller()
@UseFilters(new GrpcExceptionFilter())
export class OrderGrpcController {
  constructor(
    private readonly queryHandler: OrderQueryHandler,
    private readonly cancelHandler: CancelOrderHandler,
  ) {}

  @GrpcMethod('OrderService', 'GetOrder')
  async getOrder(data: GetOrderRequest) {
    const order = await this.queryHandler.getOrder(new GetOrderQuery(data.orderId));
    return this.mapToResponse(order);
  }

  @GrpcMethod('OrderService', 'GetOrderBatch')
  async getOrderBatch(data: GetOrderBatchRequest) {
    const orders = await Promise.all(
      data.orderIds.map((id) =>
        this.queryHandler.getOrder(new GetOrderQuery(id)).catch(() => null),
      ),
    );
    return { orders: orders.filter(Boolean).map((o: unknown) => this.mapToResponse(o)) };
  }

  @GrpcMethod('OrderService', 'GetOrdersByUser')
  async getOrdersByUser(data: GetOrdersByUserRequest) {
    const result = await this.queryHandler.listOrders(
      new ListOrdersQuery(data.userId, data.page, data.pageSize, data.statusFilter),
    );
    return {
      orders: result.orders.map((o: unknown) => this.mapToResponse(o)),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  @GrpcMethod('OrderService', 'CancelOrder')
  async cancelOrder(data: CancelOrderRequest) {
    await this.cancelHandler.execute(
      new CancelOrderCommand(data.orderId, data.userId, data.reason, 'user'),
    );
    return { success: true, message: 'Order cancelled successfully' };
  }

  private mapToResponse(order: unknown) {
    const o = order as Record<string, unknown>;
    return {
      id: o['id'],
      userId: o['userId'],
      status: o['status'],
      totalAmount: o['totalCents'],
      currency: o['currency'] ?? 'VND',
      items: (o['items'] as unknown[]) ?? [],
      createdAt:
        o['createdAt'] instanceof Date ? (o['createdAt'] as Date).getTime() : o['createdAt'],
      updatedAt:
        o['updatedAt'] instanceof Date ? (o['updatedAt'] as Date).getTime() : o['updatedAt'],
    };
  }
}
