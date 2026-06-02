import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { ProductStock } from '../entities/product-stock.entity';

@Injectable()
export class StockRepository {
  private readonly logger = new Logger(StockRepository.name);

  constructor(
    @InjectRepository(ProductStock)
    private readonly repo: Repository<ProductStock>,
  ) {}

  async findByProductId(productId: string, variantId?: string): Promise<ProductStock | null> {
    return this.repo.findOne({
      where: { productId, ...(variantId !== undefined ? { variantId } : {}) },
    });
  }

  async findByProductIds(productIds: string[]): Promise<ProductStock[]> {
    return this.repo.find({ where: { productId: In(productIds) } });
  }

  async findLowStock(): Promise<ProductStock[]> {
    return this.repo
      .createQueryBuilder('s')
      .where('s.available <= s.lowStockThreshold AND s.isActive = true')
      .getMany();
  }

  async findAll(opts: { page: number; limit: number }): Promise<{ items: ProductStock[]; total: number }> {
    const [items, total] = await this.repo.findAndCount({
      where: { isActive: true },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
      order: { updatedAt: 'DESC' },
    });
    return { items, total };
  }

  async save(stock: ProductStock): Promise<ProductStock> {
    return this.repo.save(stock);
  }

  async create(data: Partial<ProductStock>): Promise<ProductStock> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  /**
   * Atomic decrement using optimistic lock.
   * Returns true if successful, false if concurrent update.
   */
  async decrementAvailable(
    productId: string,
    variantId: string | undefined,
    amount: number,
    version: number,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(ProductStock)
      .set({
        available: () => `available - ${amount}`,
        reserved: () => `reserved + ${amount}`,
        version: () => 'version + 1',
      })
      .where(
        'productId = :productId AND available >= :amount AND version = :version AND isActive = true',
        { productId, amount, version },
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async incrementAvailable(productId: string, variantId: string | undefined, amount: number): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(ProductStock)
      .set({
        available: () => `available + ${amount}`,
        reserved: () => `GREATEST(reserved - ${amount}, 0)`,
      })
      .where('productId = :productId', { productId })
      .execute();
  }
}
