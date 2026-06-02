import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Campaign, CampaignStatus } from '../entities/campaign.entity';

// WHY a billing processor?
// Click charges must eventually reach the DB, but we don't block the click
// endpoint waiting for it. The queue decouples the fast path (UX) from the
// slow path (DB write, billing reconciliation).
// At-least-once delivery: if the worker restarts, jobs are retried.
// Idempotency: we use the impressionId as idempotency key.

@Processor('ads-events')
export class AdsBillingProcessor extends WorkerHost {
  private readonly logger = new Logger(AdsBillingProcessor.name);

  constructor(
    @InjectRepository(Campaign) private campaignRepo: Repository<Campaign>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'cpc-click') {
      await this.handleCpcClick(job.data as { campaignId: string; impressionId: string; userId?: string });
    } else if (job.name === 'cpm-charge') {
      await this.handleCpmCharge(job.data as { campaignId: string; impressionId: string; fee: number });
    }
  }

  private async handleCpcClick(data: { campaignId: string; impressionId: string; cpcVnd?: number }): Promise<void> {
    const { campaignId } = data;
    const cpc = data.cpcVnd ?? 500;

    // Update DB spent counters (non-atomic is OK here — exact tracking via Redis,
    // DB is for reporting/reconciliation only)
    await this.campaignRepo
      .createQueryBuilder()
      .update(Campaign)
      .set({
        totalSpent: () => `total_spent + ${cpc}`,
        dailySpent: () => `daily_spent + ${cpc}`,
        clicks: () => `clicks + 1`,
      })
      .where('id = :id', { id: campaignId })
      .execute();

    this.logger.debug(`CPC charge ₫${cpc} applied to campaign ${campaignId}`);
  }

  private async handleCpmCharge(data: { campaignId: string; impressionId: string; fee: number }): Promise<void> {
    const { campaignId, fee } = data;

    await this.campaignRepo
      .createQueryBuilder()
      .update(Campaign)
      .set({
        totalSpent: () => `total_spent + ${fee}`,
        dailySpent: () => `daily_spent + ${fee}`,
        impressions: () => `impressions + 1`,
      })
      .where('id = :id', { id: campaignId })
      .execute();

    // Check if budget exhausted after this charge
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId }, select: ['totalSpent', 'totalBudget', 'status'] });
    if (campaign && campaign.totalSpent >= campaign.totalBudget && campaign.status === CampaignStatus.ACTIVE) {
      await this.campaignRepo.update(campaignId, { status: CampaignStatus.BUDGET_EXHAUSTED });
      this.logger.log(`Campaign ${campaignId} budget exhausted — paused`);
    }
  }
}
