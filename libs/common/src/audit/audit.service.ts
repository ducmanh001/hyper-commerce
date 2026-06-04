/**
 * AuditService
 *
 * Writes audit logs asynchronously — never blocks the main request.
 * Uses setImmediate() to defer the INSERT so the HTTP response is sent first.
 *
 * In high-throughput scenarios (> 10K req/s), replace the direct INSERT
 * with a Kafka publish (topic: audit-events) and a dedicated consumer
 * that batch-inserts via COPY — this is the Twitter-scale pattern.
 * For most platforms a direct async INSERT is fine.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { AuditAction } from './audit.entity';
import { AuditLog } from './audit.entity';

export interface CreateAuditInput {
  actorId: string;
  actorEmail: string;
  actorRole: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  traceId?: string;
  success?: boolean;
  errorMessage?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Append an audit record.
   * Fire-and-forget: errors are swallowed and logged — we never want audit
   * logging to break the primary business flow.
   */
  log(input: CreateAuditInput): void {
    setImmediate(async () => {
      try {
        await this.repo.insert({
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          changes: input.changes as any,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          traceId: input.traceId,
          success: input.success ?? true,
          errorMessage: input.errorMessage,
        });
      } catch (err) {
        this.logger.error(`Audit log insert failed: ${String(err)}`);
      }
    });
  }

  /** Paginated query for admin audit log viewer */
  async findMany(opts: {
    actorId?: string;
    resource?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ items: AuditLog[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 200);

    const qb = this.repo.createQueryBuilder('al').orderBy('al.createdAt', 'DESC');

    if (opts.actorId) qb.andWhere('al.actorId = :actorId', { actorId: opts.actorId });
    if (opts.resource) qb.andWhere('al.resource = :resource', { resource: opts.resource });
    if (opts.action) qb.andWhere('al.action = :action', { action: opts.action });
    if (opts.from) qb.andWhere('al.createdAt >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('al.createdAt <= :to', { to: opts.to });

    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items, total };
  }
}
