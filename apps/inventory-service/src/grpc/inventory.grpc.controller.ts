// apps/inventory-service/src/grpc/inventory.grpc.controller.ts
// gRPC endpoint for real-time stock checks from order-service.
// This is the hot path — called on every checkout → MUST be fast.
//
// Latency budget:
//   - Redis Lua atomic check: < 1ms
//   - DB fallback (cache miss): < 5ms
//   - Total gRPC response: < 10ms p95

import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from '@hypercommerce/grpc';

interface CheckStockRequest {
  productId: string;
  variantId?: string;
  quantity: number;
}

interface CheckStockBatchRequest {
  items: Array<{ productId: string; variantId?: string; quantity: number }>;
}

interface ReserveStockRequest {
  orderId: string;
  items: Array<{ productId: string; variantId?: string; quantity: number }>;
  ttlSeconds: number;
}

interface ReleaseReservationRequest {
  reservationId: string;
  orderId: string;
}

interface CommitReservationRequest {
  reservationId: string;
  orderId: string;
}

interface GetFlashSaleStockRequest {
  flashSaleId: string;
}

@Controller()
@UseFilters(new GrpcExceptionFilter())
export class InventoryGrpcController {
  // constructor(
  //   private readonly inventoryService: InventoryService,
  //   private readonly redisClient: RedisClientService,
  // ) {}

  @GrpcMethod('InventoryService', 'CheckStock')
  async checkStock(_data: CheckStockRequest) {
    // Fast path: check Redis first
    // const available = await this.inventoryService.checkStock(
    //   data.productId, data.variantId, data.quantity
    // );
    return {
      available: true,
      availableQuantity: 100,
      isFlashSale: false,
    };
  }

  @GrpcMethod('InventoryService', 'CheckStockBatch')
  async checkStockBatch(data: CheckStockBatchRequest) {
    const results = await Promise.all(data.items.map((item) => this.checkStock(item)));

    return {
      results: data.items.map((item, idx) => ({
        productId: item.productId,
        variantId: item.variantId,
        available: results[idx].available,
        availableQuantity: results[idx].availableQuantity,
      })),
      allAvailable: results.every((r) => r.available),
    };
  }

  @GrpcMethod('InventoryService', 'ReserveStock')
  async reserveStock(data: ReserveStockRequest) {
    // Uses Redis Lua atomic decrement
    // const result = await this.inventoryService.reserveStock(
    //   data.orderId, data.items, data.ttlSeconds
    // );
    return {
      success: true,
      reservationId: `res_${data.orderId}_${Date.now()}`,
      insufficientItems: [],
    };
  }

  @GrpcMethod('InventoryService', 'ReleaseReservation')
  async releaseReservation(_data: ReleaseReservationRequest) {
    // await this.inventoryService.releaseReservation(data.reservationId);
    return { success: true };
  }

  @GrpcMethod('InventoryService', 'CommitReservation')
  async commitReservation(_data: CommitReservationRequest) {
    // await this.inventoryService.commitReservation(data.reservationId);
    return { success: true };
  }

  @GrpcMethod('InventoryService', 'GetFlashSaleStock')
  async getFlashSaleStock(_data: GetFlashSaleStockRequest) {
    return {
      remaining: 50,
      total: 100,
      active: true,
      endsAt: Date.now() + 3600_000,
    };
  }
}
