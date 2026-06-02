// apps/order-service/src/factories/order.factory.ts
// Creates Order + OrderItem entities from CreateOrderDto.
// Encapsulates all entity construction logic — service files stay clean.

import {
  OrderStatus,
  ORDER_LIMITS,
} from '../constants/order.constants';

export interface CreateOrderInput {
  userId: string;
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    productName: string;
    thumbnailUrl?: string;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    recipientName: string;
    phone: string;
  };
  couponCode?: string;
  notes?: string;
  paymentMethod: string;
}

export interface OrderEntity {
  id: string;
  userId: string;
  status: OrderStatus;
  items: OrderItemEntity[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  shippingAddress: Record<string, string>;
  couponCode?: string;
  notes?: string;
  paymentMethod: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemEntity {
  productId: string;
  variantId?: string;
  productName: string;
  thumbnailUrl?: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

export class OrderFactory {
  /**
   * Build an Order entity ready for persistence.
   * Does NOT save to DB — call orderRepository.save() afterwards.
   */
  createOrder(input: CreateOrderInput): OrderEntity {
    const items = input.items.map((item) => this.createOrderItem(item));
    const subtotalCents = items.reduce((s, i) => s + i.totalPriceCents, 0);
    const shippingCents = this.calculateShipping(subtotalCents);
    const discountCents = 0; // Applied later by coupon service

    return {
      id: crypto.randomUUID(),
      userId: input.userId,
      status: OrderStatus.PENDING,
      items,
      subtotalCents,
      shippingCents,
      discountCents,
      totalCents: subtotalCents + shippingCents - discountCents,
      currency: 'VND',
      shippingAddress: input.shippingAddress as unknown as Record<string, string>,
      couponCode: input.couponCode,
      notes: input.notes,
      paymentMethod: input.paymentMethod,
      idempotencyKey: `${input.userId}:${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private createOrderItem(
    item: CreateOrderInput['items'][0],
  ): OrderItemEntity {
    const quantity = Math.min(item.quantity, ORDER_LIMITS.MAX_QUANTITY_PER_ITEM);
    return {
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      thumbnailUrl: item.thumbnailUrl,
      quantity,
      unitPriceCents: item.unitPrice,
      totalPriceCents: item.unitPrice * quantity,
    };
  }

  private calculateShipping(subtotalCents: number): number {
    // Free shipping above 300,000 VND
    if (subtotalCents >= 300_000_00) return 0;
    // Standard shipping: 30,000 VND
    return 30_000_00;
  }
}
