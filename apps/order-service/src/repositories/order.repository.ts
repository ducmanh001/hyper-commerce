import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  FindOptionsWhere,
  MoreThanOrEqual,
  LessThanOrEqual,
  Between,
} from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { CursorPaginationDto } from '@hypercommerce/common';

export interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  statusBreakdown: Record<OrderStatus, number>;
}

export interface PaginatedOrders {
  items: Order[];
  nextCursor: string | null;
  total: number;
}

/**
 * OrderRepository — data access layer for orders.
 *
 * All DB queries live here. The service layer never touches EntityManager
 * or QueryBuilder directly — it calls this repository.
 *
 * Key patterns:
 * - Cursor-based pagination (no OFFSET — doesn't scale at 50M rows)
 * - All queries include userId for Citus shard routing
 * - Optimistic locking for status transitions
 */
@Injectable()
export class OrderRepository {
  private readonly logger = new Logger(OrderRepository.name);

  constructor(
    @InjectRepository(Order)
    private readonly repo: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  async findById(id: string): Promise<Order | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIdWithItems(id: string): Promise<Order | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['items'],
    });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Order | null> {
    return this.repo.findOne({ where: { id, userId } });
  }

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    return this.repo.findOne({ where: { idempotencyKey: key } });
  }

  /**
   * Cursor-based pagination — O(log n) via index seek.
   * cursor = base64(createdAt + ":" + id) for stable ordering.
   */
  async findByUserId(
    userId: string,
    pagination: CursorPaginationDto,
  ): Promise<PaginatedOrders> {
    const limit = pagination.limit ?? 20;
    const qb = this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .where('o.userId = :userId', { userId })
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .take(limit + 1); // fetch one extra to check hasMore

    if (pagination.cursor) {
      const { createdAt, id } = this.decodeCursor(pagination.cursor);
      qb.andWhere(
        '(o.createdAt < :createdAt OR (o.createdAt = :createdAt AND o.id < :id))',
        { createdAt, id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasMore && lastItem
        ? this.encodeCursor(lastItem.createdAt, lastItem.id)
        : null,
      total: await this.repo.count({ where: { userId } }),
    };
  }

  async findBySellerId(
    sellerId: string,
    pagination: CursorPaginationDto,
  ): Promise<PaginatedOrders> {
    const limit = pagination.limit ?? 20;
    const qb = this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .where('o.sellerId = :sellerId', { sellerId })
      .orderBy('o.createdAt', 'DESC')
      .take(limit + 1);

    if (pagination.cursor) {
      const { createdAt, id } = this.decodeCursor(pagination.cursor);
      qb.andWhere('(o.createdAt < :createdAt OR (o.createdAt = :createdAt AND o.id < :id))', { createdAt, id });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasMore && lastItem
        ? this.encodeCursor(lastItem.createdAt, lastItem.id)
        : null,
      total: await this.repo.count({ where: { sellerId } }),
    };
  }

  async findByStatus(
    status: OrderStatus,
    pagination: CursorPaginationDto,
  ): Promise<PaginatedOrders> {
    const limit = pagination.limit ?? 20;
    const items = await this.repo.find({
      where: { status },
      take: limit,
      skip: 0,
      order: { createdAt: 'DESC' },
    });
    return {
      items,
      nextCursor: null,
      total: await this.repo.count({ where: { status } }),
    };
  }

  /**
   * Aggregated stats — used by admin dashboard and analytics service.
   */
  async getStats(from: Date, to: Date): Promise<OrderStats> {
    const result = await this.repo
      .createQueryBuilder('o')
      .select('COUNT(o.id)', 'totalOrders')
      .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'totalRevenue')
      .addSelect('COALESCE(AVG(o.totalAmount), 0)', 'avgOrderValue')
      .where('o.createdAt BETWEEN :from AND :to', { from, to })
      .getRawOne<{ totalOrders: string; totalRevenue: string; avgOrderValue: string }>();

    const breakdown = await this.repo
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(o.id)', 'count')
      .where('o.createdAt BETWEEN :from AND :to', { from, to })
      .groupBy('o.status')
      .getRawMany<{ status: OrderStatus; count: string }>();

    const statusBreakdown = breakdown.reduce(
      (acc, row) => ({ ...acc, [row.status]: parseInt(row.count, 10) }),
      {} as Record<OrderStatus, number>,
    );

    return {
      totalOrders: parseInt(result?.totalOrders ?? '0', 10),
      totalRevenue: parseInt(result?.totalRevenue ?? '0', 10),
      avgOrderValue: parseFloat(result?.avgOrderValue ?? '0'),
      statusBreakdown,
    };
  }

  async save(order: Order): Promise<Order> {
    return this.repo.save(order);
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    extra?: Partial<Pick<Order, 'cancelledAt' | 'cancellationReason' | 'cancelledBy' | 'confirmedAt' | 'completedAt' | 'refundedAt'>>,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.repo.update(id, { status, ...(extra ?? {}) } as any);
  }

  async create(data: Partial<Order>): Promise<Order> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  /**
   * Optimistic-lock update — only succeeds if version matches.
   * Returns affected row count (0 = concurrent update detected).
   */
  async updateWithLock(
    id: string,
    version: number,
    changes: Omit<Partial<Order>, 'metadata'> & { metadata?: Record<string, unknown> },
  ): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.repo
      .createQueryBuilder()
      .update(Order)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ ...(changes as any), version: () => 'version + 1' } as any)
      .where('id = :id AND version = :version', { id, version })
      .execute();
    return result.affected ?? 0;
  }

  // ── Cursor helpers ────────────────────────────────────────

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}:${id}`).toString('base64url');
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    return {
      createdAt: new Date(decoded.substring(0, colonIdx)),
      id: decoded.substring(colonIdx + 1),
    };
  }
}
