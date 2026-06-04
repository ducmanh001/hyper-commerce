import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Refund } from '../entities/refund.entity';

@Injectable()
export class RefundRepository {
  constructor(
    @InjectRepository(Refund)
    private readonly repo: Repository<Refund>,
  ) {}

  async findByPaymentId(paymentId: string): Promise<Refund[]> {
    return this.repo.find({ where: { paymentId }, order: { createdAt: 'DESC' } });
  }

  async findByOrderId(orderId: string): Promise<Refund[]> {
    return this.repo.find({ where: { orderId } });
  }

  async getTotalRefundedAmount(paymentId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.amount), 0)', 'total')
      .where('r.paymentId = :paymentId AND r.status = :status', {
        paymentId,
        status: 'REFUNDED',
      })
      .getRawOne<{ total: string }>();
    return parseInt(result?.total ?? '0', 10);
  }

  async create(data: Partial<Refund>): Promise<Refund> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async updateStatus(
    id: string,
    status: Refund['status'],
    refundReference?: string,
  ): Promise<void> {
    await this.repo.update(id, { status, ...(refundReference ? { refundReference } : {}) });
  }
}
