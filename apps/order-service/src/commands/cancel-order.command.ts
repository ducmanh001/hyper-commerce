// apps/order-service/src/commands/cancel-order.command.ts

export class CancelOrderCommand {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly reason: string,
    /** 'user' | 'system' | 'admin' */
    public readonly initiatedBy: 'user' | 'system' | 'admin' = 'user',
  ) {}
}
