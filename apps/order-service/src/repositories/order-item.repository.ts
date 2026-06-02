import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { OrderItem } from '../entities/order-item.entity';

@Injectable()
export class OrderItemRepository {
  constructor(
    @InjectRepository(OrderItem)
    private readonly repo: Repository<OrderItem>,
  ) {}

  async findByOrderId(orderId: string): Promise<OrderItem[]> {
    return this.repo.find({
      where: { orderId },
      order: { productId: 'ASC' },
    });
  }

  async findByOrderIds(orderIds: string[]): Promise<OrderItem[]> {
    if (orderIds.length === 0) return [];
    return this.repo.find({ where: { orderId: In(orderIds) } });
  }

  async bulkCreate(items: Partial<OrderItem>[]): Promise<OrderItem[]> {
    const entities = this.repo.create(items);
    return this.repo.save(entities);
  }

  async deleteByOrderId(orderId: string): Promise<void> {
    await this.repo.delete({ orderId });
  }
}
