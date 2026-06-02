import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../entities/order.entity';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';

export class OrderItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiPropertyOptional() variantId?: string;
  @ApiProperty() productName!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() subtotal!: number;
  @ApiPropertyOptional() snapshot?: Record<string, unknown>;

  static fromEntity(item: OrderItem): OrderItemResponseDto {
    const dto = new OrderItemResponseDto();
    dto.id = item.id;
    dto.productId = item.productId;
    dto.variantId = item.variantId;
    dto.productName = item.productName;
    dto.quantity = item.quantity;
    dto.unitPrice = item.unitPrice;
    dto.subtotal = item.subtotal;
    dto.snapshot = item.snapshot;
    return dto;
  }
}

export class OrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() sellerId?: string;
  @ApiProperty() status!: OrderStatus;
  @ApiProperty() totalAmount!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional() shippingAddress?: Record<string, string>;
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty() version!: number;
  @ApiPropertyOptional() idempotencyKey?: string;
  @ApiPropertyOptional() metadata?: Record<string, unknown>;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromEntity(order: Order, items: OrderItem[]): OrderResponseDto {
    const dto = new OrderResponseDto();
    dto.id = order.id;
    dto.userId = order.userId;
    dto.sellerId = order.sellerId;
    dto.status = order.status;
    dto.totalAmount = order.totalAmount;
    dto.currency = order.currency;
    dto.shippingAddress = order.shippingAddress;
    dto.items = items.map(OrderItemResponseDto.fromEntity);
    dto.version = order.version;
    dto.idempotencyKey = order.idempotencyKey;
    dto.metadata = order.metadata;
    dto.createdAt = order.createdAt;
    dto.updatedAt = order.updatedAt;
    return dto;
  }
}
