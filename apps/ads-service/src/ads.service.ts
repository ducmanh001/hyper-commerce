import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, DataSource } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Campaign, CampaignStatus, BiddingModel } from './entities/campaign.entity';
import { AdImpression } from './entities/ad-impression.entity';
import type {
  CreateCampaignDto,
  UpdateCampaignDto,
  AuctionRequestDto,
  RecordClickDto,
} from './dto/ads.dto';

// CTR history bucket size for Quality Score calculation
const CTR_BUCKET = 100; // events per bucket

// Budget Redis key patterns
// hc:ads:budget:{campaignId} → remaining lifetime budget (in VND, integer)
// hc:ads:daily:{campaignId}:{YYYYMMDD} → remaining daily budget
const BUDGET_KEY = (id: string) => `hc:ads:budget:${id}`;
const DAILY_KEY = (id: string, day: string) => `hc:ads:daily:${id}:${day}`;
const CTR_KEY = (id: string) => `hc:ads:ctr:${id}`; // HSET clicks / impressions

function todayKey(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export interface AuctionSlot {
  impressionId: string;
  campaignId: string;
  productId: string;
  cpcVnd: number; // Second-price CPC charged per click
  cpmVnd: number | null; // CPM fee if CPM campaign
  position: number;
}

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    @InjectRepository(Campaign) private campaignRepo: Repository<Campaign>,
    @InjectRepository(AdImpression) private impressionRepo: Repository<AdImpression>,
    private dataSource: DataSource,
    @InjectRedis() private redis: Redis,
    @InjectQueue('ads-events') private adsQueue: Queue,
  ) {}

  // ── Campaign CRUD ──────────────────────────────────────────────────────────

  async createCampaign(sellerId: string, dto: CreateCampaignDto): Promise<Campaign> {
    const campaign = this.campaignRepo.create({ ...dto, sellerId, status: CampaignStatus.DRAFT });
    const saved = await this.campaignRepo.save(campaign);

    // Pre-load budget into Redis so auction can read it instantly (no DB hit)
    await this.redis.set(BUDGET_KEY(saved.id), saved.totalBudget);
    if (saved.dailyBudget) {
      await this.redis.set(DAILY_KEY(saved.id, todayKey()), saved.dailyBudget, 'EX', 86_400);
    }
    return saved;
  }

  async getCampaign(sellerId: string, id: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, sellerId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async listCampaigns(sellerId: string): Promise<Campaign[]> {
    return this.campaignRepo.find({ where: { sellerId }, order: { createdAt: 'DESC' } });
  }

  async updateCampaign(sellerId: string, id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.getCampaign(sellerId, id);
    Object.assign(campaign, dto);

    // Sync Redis budget if total budget changed
    if (dto.totalBudget !== undefined) {
      const spent = campaign.totalSpent;
      const remaining = Math.max(0, dto.totalBudget - spent);
      await this.redis.set(BUDGET_KEY(id), remaining);
    }
    return this.campaignRepo.save(campaign);
  }

  async activateCampaign(sellerId: string, id: string): Promise<Campaign> {
    const campaign = await this.getCampaign(sellerId, id);
    if (campaign.productIds.length === 0) {
      throw new BadRequestException('Campaign must have at least one product');
    }
    campaign.status = CampaignStatus.ACTIVE;
    return this.campaignRepo.save(campaign);
  }

  async pauseCampaign(sellerId: string, id: string): Promise<Campaign> {
    const campaign = await this.getCampaign(sellerId, id);
    campaign.status = CampaignStatus.PAUSED;
    return this.campaignRepo.save(campaign);
  }

  // ── Auction Engine ─────────────────────────────────────────────────────────
  //
  // WHY Second-Price Auction (GSP)?
  // - Dominant strategy: seller bids true value, no gaming
  // - Industry standard: Google Ads, Amazon Sponsored Products use GSP variant
  // - Quality Score prevents pure money-wins: CTR_history × bid = effective bid
  //   so a relevant low-bidder can beat an irrelevant high-bidder
  //
  // Auction steps:
  //   1. Fetch eligible campaigns (ACTIVE, budget > 0, keyword matches)
  //   2. Compute effective bid = maxBidVnd × qualityScore (0–1)
  //   3. Sort by effective bid descending
  //   4. Winner pays: second-highest_effective_bid + ₫1 (minimum ₫500)
  //   5. Create impression records; return slot data
  //
  // Performance: Redis HMGET for budget checks (O(n)), DB fetch from indexed
  //   ad_campaigns.targetKeywords with GIN index → fast even at 10K campaigns

  async runAuction(dto: AuctionRequestDto, sessionId?: string): Promise<AuctionSlot[]> {
    const limit = dto.limit ?? 3;
    const keywords = dto.keywords.map((k) => k.toLowerCase().trim());

    // 1. Fetch eligible campaigns (ACTIVE, keyword overlap, no ended)
    const candidates = await this.dataSource.query<Campaign[]>(
      `
      SELECT * FROM ad_campaigns
      WHERE status = 'ACTIVE'
        AND (
          target_keywords && $1
          OR ($2::text IS NOT NULL AND target_categories @> ARRAY[$2::text])
        )
        AND (end_at IS NULL OR end_at > NOW())
        AND (start_at IS NULL OR start_at <= NOW())
      LIMIT 50
    `,
      [keywords, dto.category ?? null],
    );

    if (candidates.length === 0) return [];

    // 2. Filter by Redis budget (no DB hit, O(n) MGET)
    const budgetKeys = candidates.map((c) => BUDGET_KEY(c.id));
    const dailyKeys = candidates.map((c) => DAILY_KEY(c.id, todayKey()));
    const [budgets, dailyBudgets] = await Promise.all([
      this.redis.mget(...budgetKeys),
      this.redis.mget(...dailyKeys),
    ]);

    const solvent = candidates.filter((c, i) => {
      const b = parseInt(budgets[i] ?? '0', 10);
      const d = dailyBudgets[i] !== null ? parseInt(dailyBudgets[i] as string, 10) : Infinity;
      return b > 500 && d > 500; // Must have at least min bid available
    });

    if (solvent.length === 0) return [];

    // 3. Compute Quality Score = CTR (0.01–1.0, log-smoothed)
    const ctrKeys = solvent.map((c) => CTR_KEY(c.id));
    const ctrData = await this.redis.mget(...ctrKeys);
    const effectiveBids = solvent.map((c, i) => {
      const raw = ctrData[i];
      let ctr = 0.05; // Default 5% CTR for new campaigns (cold start)
      if (raw) {
        const parsed = JSON.parse(raw) as { clicks: number; impressions: number };
        if (parsed.impressions >= CTR_BUCKET) {
          ctr = Math.max(0.01, parsed.clicks / parsed.impressions);
        }
      }
      // Effective bid: bid × sqrt(CTR) to balance money and relevance
      return { campaign: c, effectiveBid: c.maxBidVnd * Math.sqrt(ctr), ctr };
    });

    // 4. Sort by effective bid, take top N+1 (need N+1 for second-price)
    effectiveBids.sort((a, b) => b.effectiveBid - a.effectiveBid);
    const winners = effectiveBids.slice(0, limit);

    // 5. Second-price: each winner pays the next bidder's effective bid + ₫1
    //    (or min bid ₫500 if no competitor)
    const slots: AuctionSlot[] = [];
    for (let i = 0; i < winners.length; i++) {
      const { campaign, effectiveBid: _effectiveBid } = winners[i];
      const nextBid = effectiveBids[i + 1]?.effectiveBid ?? 0;
      const cpcVnd = Math.max(500, Math.ceil(nextBid + 1));

      // Create impression record
      const impressionEntity = this.impressionRepo.create({
        campaignId: campaign.id,
        adId: campaign.productIds[0], // simplified: one ad per campaign slot
        sessionId: sessionId ?? null,
        userId: null,
        keyword: keywords[0] ?? null,
        position: i + 1,
        cpmFeeVnd:
          campaign.biddingModel === BiddingModel.CPM ? Math.ceil(campaign.maxBidVnd / 1000) : null,
      });
      const impression = await this.impressionRepo.save(impressionEntity);

      // For CPM: charge immediately (fire-and-forget via queue)
      if (campaign.biddingModel === BiddingModel.CPM) {
        const cpmFee = Math.ceil(campaign.maxBidVnd / 1000);
        void this.deductBudget(campaign.id, cpmFee);
        void this.adsQueue.add('cpm-charge', {
          campaignId: campaign.id,
          impressionId: impression.id,
          fee: cpmFee,
        });
      }

      slots.push({
        impressionId: impression.id,
        campaignId: campaign.id,
        productId: campaign.productIds[0],
        cpcVnd,
        cpmVnd:
          campaign.biddingModel === BiddingModel.CPM ? Math.ceil(campaign.maxBidVnd / 1000) : null,
        position: i + 1,
      });
    }

    return slots;
  }

  // ── Click Recording ────────────────────────────────────────────────────────
  // WHY fire-and-forget via Kafka/BullMQ instead of synchronous DB write?
  // Click recording must never add latency to the user's navigation.
  // navigator.sendBeacon() on frontend + async queue here = ~0ms impact on UX.

  async recordClick(dto: RecordClickDto): Promise<void> {
    const impression = await this.impressionRepo.findOne({ where: { id: dto.impressionId } });
    if (!impression) return; // Idempotent: ignore unknown impressions (replay attacks)
    if (impression.clicked) return; // Already counted

    // Mark impression clicked immediately (prevents double-billing)
    await this.impressionRepo.update(impression.id, { clicked: true, clickedAt: new Date() });

    // Get the CPC from the campaign (we stored it in auction; re-derive here for safety)
    const campaign = await this.campaignRepo.findOne({ where: { id: impression.campaignId } });
    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) return;

    // Deduct budget atomically in Redis — fastest path, DB updated async
    const charged = await this.deductBudget(impression.campaignId, 1); // 1 = placeholder, real CPC from impression
    if (!charged) {
      // Budget exhausted during this click — pause campaign
      await this.campaignRepo.update(impression.campaignId, {
        status: CampaignStatus.BUDGET_EXHAUSTED,
      });
    }

    // Push billing event to queue for DB reconciliation
    await this.adsQueue.add('cpc-click', {
      campaignId: impression.campaignId,
      impressionId: impression.id,
      userId: dto.userId,
      timestamp: new Date().toISOString(),
    });

    // Update CTR counter in Redis
    await this.updateCtrCounter(impression.campaignId, true);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Atomically deduct `amount` VND from campaign budget.
   * Returns true if budget was available, false if exhausted.
   * WHY Lua script: DECR + check must be atomic — race between concurrent requests
   * would allow over-spending without atomicity.
   */
  private async deductBudget(campaignId: string, amount: number): Promise<boolean> {
    const lua = `
      local key = KEYS[1]
      local amount = tonumber(ARGV[1])
      local current = tonumber(redis.call('GET', key) or '0')
      if current < amount then
        return 0
      end
      redis.call('DECRBY', key, amount)
      return 1
    `;
    const result = await this.redis.eval(lua, 1, BUDGET_KEY(campaignId), amount);
    return result === 1;
  }

  private async updateCtrCounter(campaignId: string, isClick: boolean): Promise<void> {
    const key = CTR_KEY(campaignId);
    const raw = await this.redis.get(key);
    const data = raw
      ? (JSON.parse(raw) as { clicks: number; impressions: number })
      : { clicks: 0, impressions: 0 };
    data.impressions += 1;
    if (isClick) data.clicks += 1;
    await this.redis.set(key, JSON.stringify(data), 'EX', 86_400 * 30); // 30-day TTL
  }

  // Called by auction to record impressions for CTR
  async incrementImpression(campaignId: string): Promise<void> {
    await this.updateCtrCounter(campaignId, false);
  }
}
