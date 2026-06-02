// apps/order-service/src/queries/get-order.query.ts
export class GetOrderQuery {
  constructor(
    public readonly orderId: string,
    /** Optional: enforce ownership check */
    public readonly requestingUserId?: string,
  ) {}
}

// apps/order-service/src/queries/list-orders.query.ts
export class ListOrdersQuery {
  constructor(
    public readonly userId: string,
    public readonly page: number = 1,
    public readonly limit: number = 20,
    public readonly statusFilter?: string,
    public readonly sortBy: 'createdAt' | 'updatedAt' | 'totalCents' = 'createdAt',
    public readonly sortOrder: 'ASC' | 'DESC' = 'DESC',
  ) {}
}
