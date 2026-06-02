import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, ILike } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.repo.findOne({ where: { username: username.toLowerCase().trim() } });
  }

  async findByEmailOrUsername(identifier: string): Promise<User | null> {
    const lower = identifier.toLowerCase().trim();
    return this.repo
      .createQueryBuilder('u')
      .where('u.email = :identifier OR u.username = :identifier', { identifier: lower })
      .getOne();
  }

  /** Full-text search by username or displayName */
  async search(query: string, limit = 20): Promise<User[]> {
    return this.repo
      .createQueryBuilder('u')
      .where('u.username ILIKE :q OR u.fullName ILIKE :q', { q: `%${query}%` })
      .andWhere('u.status = :status', { status: 'ACTIVE' })
      .take(limit)
      .getMany();
  }

  async create(data: Partial<User>): Promise<User> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  async updateLoginInfo(id: string, ip: string): Promise<void> {
    await this.repo.update(id, {
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      loginFailureCount: 0,
    });
  }

  async incrementLoginFailure(id: string): Promise<number> {
    await this.repo.increment({ id }, 'loginFailureCount', 1);
    const user = await this.repo.findOne({ where: { id } });
    return user?.loginFailureCount ?? 0;
  }

  async lockAccount(id: string, until: Date): Promise<void> {
    await this.repo.update(id, { lockedUntil: until, status: 'SUSPENDED' });
  }

  async incrementFollowerCount(id: string, by = 1): Promise<void> {
    await this.repo.increment({ id }, 'followerCount', by);
  }

  async decrementFollowerCount(id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(User)
      .set({ followerCount: () => 'GREATEST(follower_count - 1, 0)' })
      .where('id = :id', { id })
      .execute();
  }

  async countFollowers(userId: string): Promise<number> {
    const user = await this.repo.findOne({ where: { id: userId }, select: ['followerCount'] });
    return user?.followerCount ?? 0;
  }
}
