// apps/order-service/src/commands/create-order.command.ts
// CQRS Command — plain data object, no logic.

export class CreateOrderCommand {
  constructor(
    public readonly userId: string,
    public readonly items: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
      unitPrice: number;
      productName: string;
    }>,
    public readonly shippingAddress: {
      street: string;
      city: string;
      province: string;
      postalCode: string;
      country: string;
      recipientName: string;
      phone: string;
    },
    public readonly paymentMethod: string,
    public readonly couponCode?: string,
    public readonly notes?: string,
    /** For idempotency — prevent duplicate orders on retry */
    public readonly idempotencyKey?: string,
  ) {}
}
