import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { StockReservation } from '../entities/stock-reservation.entity';

@Injectable()
export class ReservationRepository {
  constructor(
    @InjectRepository(StockReservation)
    private readonly repo: Repository<StockReservation>,
  ) {}

  async findByOrderId(orderId: string): Promise<StockReservation[]> {
    return this.repo.find({ where: { orderId, status: 'PENDING' } });
  }

  async findExpired(): Promise<StockReservation[]> {
    return this.repo.find({
      where: { status: 'PENDING', expiresAt: LessThan(new Date()) },
    });
  }

  async bulkCreate(reservations: Partial<StockReservation>[]): Promise<StockReservation[]> {
    const entities = this.repo.create(reservations);
    return this.repo.save(entities);
  }

  async releaseByOrderId(orderId: string): Promise<void> {
    await this.repo.update({ orderId, status: 'PENDING' }, { status: 'RELEASED' });
  }

  async confirmByOrderId(orderId: string): Promise<void> {
    await this.repo.update({ orderId, status: 'PENDING' }, { status: 'CONFIRMED' });
  }

  async expireBatch(ids: string[]): Promise<void> {
    await this.repo.update({ id: undefined }, { status: 'EXPIRED' });
    for (const id of ids) {
      await this.repo.update(id, { status: 'EXPIRED' });
    }
  }
}
