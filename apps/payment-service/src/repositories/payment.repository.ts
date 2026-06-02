import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';

@Injectable()
export class PaymentRepository {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
  ) {}

  async findById(id: string): Promise<Payment | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    return this.repo.findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    return this.repo.findOne({ where: { idempotencyKey: key } });
  }

  async create(data: Partial<Payment>): Promise<Payment> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async save(payment: Payment): Promise<Payment> {
    return this.repo.save(payment);
  }

  async updateStatus(
    id: string,
    status: string,
    extraData?: Partial<Payment>,
  ): Promise<void> {
    await this.repo.update(id, { status: status as Payment['status'], ...extraData });
  }
}
