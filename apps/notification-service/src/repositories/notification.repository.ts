import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { NotificationStatus } from '../entities/notification.entity';
import { Notification } from '../entities/notification.entity';

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(data: Partial<Notification>): Promise<Notification> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async updateStatus(id: string, status: NotificationStatus, deliveredAt?: Date): Promise<void> {
    await this.repo.update(id, { status, ...(deliveredAt ? { deliveredAt } : {}) });
  }

  async findByUserId(userId: string, limit = 20): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
