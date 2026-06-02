import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseUUIDPipe,
  HttpCode, HttpStatus, Headers, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdsService } from './ads.service';
import { CreateCampaignDto, UpdateCampaignDto, AuctionRequestDto, RecordClickDto } from './dto/ads.dto';

// NOTE: In production, seller identity comes from validated JWT (user-service).
// For this service, sellerId is passed via X-Seller-Id header (set by API gateway
// after verifying the JWT). This avoids coupling ads-service to auth.

@ApiTags('ads')
@ApiBearerAuth()
@Controller()
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  // ── Campaign Management ─────────────────────────────────────────────────

  @Post('ads/campaigns')
  @ApiOperation({ summary: 'Create a new ad campaign' })
  createCampaign(
    @Headers('x-seller-id') sellerId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.adsService.createCampaign(sellerId, dto);
  }

  @Get('ads/campaigns')
  @ApiOperation({ summary: 'List all campaigns for seller' })
  listCampaigns(@Headers('x-seller-id') sellerId: string) {
    return this.adsService.listCampaigns(sellerId);
  }

  @Get('ads/campaigns/:id')
  @ApiOperation({ summary: 'Get single campaign' })
  getCampaign(
    @Headers('x-seller-id') sellerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adsService.getCampaign(sellerId, id);
  }

  @Patch('ads/campaigns/:id')
  @ApiOperation({ summary: 'Update campaign (draft or paused only)' })
  updateCampaign(
    @Headers('x-seller-id') sellerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.adsService.updateCampaign(sellerId, id, dto);
  }

  @Post('ads/campaigns/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a campaign' })
  activate(
    @Headers('x-seller-id') sellerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adsService.activateCampaign(sellerId, id);
  }

  @Post('ads/campaigns/:id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a campaign' })
  pause(
    @Headers('x-seller-id') sellerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adsService.pauseCampaign(sellerId, id);
  }

  // ── Auction ─────────────────────────────────────────────────────────────
  //
  // Called by search-service / feed-service when rendering product lists.
  // Returns ordered ad slots with impression IDs for client-side click tracking.

  @Post('ads/auction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run second-price ad auction',
    description: 'Returns ranked sponsored product slots. Called server-side by search/feed services.',
  })
  runAuction(
    @Body() dto: AuctionRequestDto,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.adsService.runAuction(dto, sessionId);
  }

  // ── Click Recording ──────────────────────────────────────────────────────
  //
  // Client calls this via navigator.sendBeacon (fire-and-forget).
  // Response can be ignored — we always return 204 to minimise client impact.

  @Post('ads/click')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record an ad click (called from browser via sendBeacon)' })
  recordClick(@Body() dto: RecordClickDto): Promise<void> {
    return this.adsService.recordClick(dto);
  }
}
