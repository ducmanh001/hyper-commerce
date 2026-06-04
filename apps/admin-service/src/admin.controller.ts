import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { AdminService } from './admin.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';

// All admin endpoints require internal JWT auth
// The guard verifies sub claim + role='admin'|'ops'
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ------------------------------------------------------------------
  // DASHBOARD SUMMARY
  // ------------------------------------------------------------------

  @Get('dashboard/summary')
  @ApiTags('analytics')
  @ApiOperation({ summary: 'Top-level KPIs for dashboard home page' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'ISO date (YYYY-MM-DD). Defaults to today.',
  })
  async getDashboardSummary(@Query('date') date?: string) {
    return this.adminService.getDashboardSummary(date);
  }

  // ------------------------------------------------------------------
  // GMV ANALYTICS
  // ------------------------------------------------------------------

  @Get('gmv/:period')
  @ApiTags('analytics')
  @ApiOperation({ summary: 'GMV breakdown by period: daily | weekly | monthly' })
  @ApiParam({ name: 'period', enum: ['daily', 'weekly', 'monthly'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getGmv(
    @Param('period') period: 'daily' | 'weekly' | 'monthly',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.getGmv(period, from, to);
  }

  @Get('gmv/category-breakdown')
  @ApiTags('analytics')
  @ApiOperation({ summary: 'GMV split by product category' })
  async getGmvByCategory(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminService.getGmvByCategory(from, to);
  }

  // ------------------------------------------------------------------
  // ORDER FUNNEL
  // ------------------------------------------------------------------

  @Get('orders/funnel')
  @ApiTags('analytics')
  @ApiOperation({ summary: 'Order status funnel — conversion rates at each step' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getOrderFunnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminService.getOrderFunnel(from, to);
  }

  @Get('orders/hourly-throughput')
  @ApiTags('analytics')
  @ApiOperation({ summary: 'Orders created per hour (last 48h from materialized view)' })
  async getHourlyThroughput() {
    return this.adminService.getHourlyThroughput();
  }

  // ------------------------------------------------------------------
  // USER MANAGEMENT (RBAC: admin, ops, trust_safety)
  // ------------------------------------------------------------------

  @Get('users')
  @ApiTags('users')
  @ApiOperation({ summary: 'List users with search, filter, pagination' })
  @ApiQuery({ name: 'q', required: false, description: 'Search by email/name' })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'banned', 'pending'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listUsers(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.adminService.listUsers({
      q,
      role,
      status,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('users/:id')
  @ApiTags('users')
  @ApiOperation({ summary: 'Get full user detail including orders, sessions, fraud signals' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id/ban')
  @ApiTags('users')
  @ApiOperation({ summary: 'Ban a user (soft-delete session, add to blocklist)' })
  @ApiParam({ name: 'id' })
  @ApiBody({
    schema: { properties: { reason: { type: 'string' }, durationDays: { type: 'number' } } },
  })
  async banUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string; durationDays?: number },
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.banUser(id, body.reason, body.durationDays, actor.sub);
  }

  @Patch('users/:id/unban')
  @ApiTags('users')
  @ApiOperation({ summary: 'Lift a user ban' })
  async unbanUser(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.unbanUser(id, actor.sub);
  }

  @Patch('users/:id/role')
  @ApiTags('users')
  @ApiOperation({ summary: "Change a user's platform role (admin only)" })
  @ApiBody({ schema: { properties: { role: { type: 'string' } } } })
  async changeUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('role') role: string,
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.changeUserRole(id, role, actor.sub);
  }

  @Post('users/:id/impersonate')
  @HttpCode(HttpStatus.OK)
  @ApiTags('users')
  @ApiOperation({ summary: 'Issue a short-lived impersonation token (SUPER_ADMIN only)' })
  async impersonateUser(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as {
      sub: string;
      role: string;
    };
    return this.adminService.impersonateUser(id, actor);
  }

  // ------------------------------------------------------------------
  // ORDER MANAGEMENT
  // ------------------------------------------------------------------

  @Get('orders')
  @ApiTags('orders')
  @ApiOperation({ summary: 'List all orders with filters' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listOrders(
    @Query('status') status?: string,
    @Query('sellerId') sellerId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.adminService.listOrders({
      status,
      sellerId,
      userId,
      from,
      to,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('orders/:id')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Full order detail with items, payments, timeline' })
  async getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getOrderDetail(id);
  }

  @Patch('orders/:id/force-status')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Admin force-transition order status (ops only, with audit)' })
  @ApiBody({ schema: { properties: { status: { type: 'string' }, reason: { type: 'string' } } } })
  async forceOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string; reason: string },
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.forceOrderStatus(id, body.status, body.reason, actor.sub);
  }

  // ------------------------------------------------------------------
  // SELLER MANAGEMENT
  // ------------------------------------------------------------------

  @Get('sellers')
  @ApiTags('sellers')
  @ApiOperation({ summary: 'List sellers with KYC status, tier, GMV' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'active', 'suspended'] })
  @ApiQuery({ name: 'tier', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listSellers(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('tier') tier?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.adminService.listSellers({
      q,
      status,
      tier,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('sellers/:sellerId/commission-summary')
  @ApiTags('sellers')
  @ApiOperation({ summary: 'Commission ledger for a specific seller' })
  @ApiParam({ name: 'sellerId', description: 'Seller UUID' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getSellerCommissionSummary(
    @Param('sellerId') sellerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.getSellerCommissionSummary(sellerId, from, to);
  }

  @Get('sellers/leaderboard')
  @ApiTags('sellers')
  @ApiOperation({ summary: 'Top sellers by GMV' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default 20' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getSellerLeaderboard(
    @Query('limit') limit = 20,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.getSellerLeaderboard(Number(limit), from, to);
  }

  @Patch('sellers/:id/verify')
  @ApiTags('sellers')
  @ApiOperation({ summary: 'Approve seller KYC verification' })
  async verifySeller(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.verifySeller(id, actor.sub);
  }

  @Patch('sellers/:id/suspend')
  @ApiTags('sellers')
  @ApiOperation({ summary: 'Suspend a seller account' })
  @ApiBody({ schema: { properties: { reason: { type: 'string' } } } })
  async suspendSeller(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.suspendSeller(id, reason, actor.sub);
  }

  // ------------------------------------------------------------------
  // DISPUTES
  // ------------------------------------------------------------------

  @Get('disputes/queue')
  @ApiTags('disputes')
  @ApiOperation({ summary: 'Open disputes requiring action, sorted by urgency' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getDisputeQueue(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.adminService.getDisputeQueue(Number(page), Number(limit));
  }

  @Get('disputes/stats')
  @ApiTags('disputes')
  @ApiOperation({ summary: 'Dispute rate, resolution time, outcome breakdown' })
  async getDisputeStats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminService.getDisputeStats(from, to);
  }

  @Patch('disputes/:id/resolve')
  @ApiTags('disputes')
  @ApiOperation({ summary: 'Admin resolve a dispute — approve refund or deny' })
  @ApiBody({
    schema: {
      properties: {
        outcome: { type: 'string', enum: ['REFUND', 'DENY', 'PARTIAL_REFUND'] },
        refundAmount: { type: 'number' },
        resolution: { type: 'string' },
      },
    },
  })
  async resolveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { outcome: string; refundAmount?: number; resolution: string },
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.resolveDispute(id, body, actor.sub);
  }

  // ------------------------------------------------------------------
  // FEATURE FLAGS
  // ------------------------------------------------------------------

  @Get('feature-flags')
  @ApiTags('system')
  @ApiOperation({ summary: 'List all feature flags' })
  async listFeatureFlags() {
    return this.adminService.listFeatureFlags();
  }

  @Post('feature-flags')
  @HttpCode(HttpStatus.CREATED)
  @ApiTags('system')
  @ApiOperation({ summary: 'Create a new feature flag' })
  async createFeatureFlag(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.upsertFeatureFlag(body['key'] as string, body, actor.sub);
  }

  @Patch('feature-flags/:key')
  @ApiTags('system')
  @ApiOperation({ summary: 'Update a feature flag (toggle, rollout %)' })
  async updateFeatureFlag(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.upsertFeatureFlag(key, body, actor.sub);
  }

  @Delete('feature-flags/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('system')
  @ApiOperation({ summary: 'Delete a feature flag (after cleanup)' })
  async deleteFeatureFlag(@Param('key') key: string, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.deleteFeatureFlag(key, actor.sub);
  }

  // ------------------------------------------------------------------
  // AUDIT LOGS
  // ------------------------------------------------------------------

  @Get('audit-logs')
  @ApiTags('system')
  @ApiOperation({ summary: 'Query audit log — who did what when' })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'resource', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getAuditLogs(
    @Query('actorId') actorId?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.adminService.getAuditLogs({
      actorId,
      resource,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: Number(page),
      limit: Number(limit),
    });
  }

  // ------------------------------------------------------------------
  // ROLES & PERMISSIONS
  // ------------------------------------------------------------------

  @Get('roles')
  @ApiTags('roles')
  @ApiOperation({ summary: 'List platform roles and their permission sets' })
  async listRoles() {
    return this.adminService.listRoles();
  }

  @Patch('roles/:userId/assign')
  @ApiTags('roles')
  @ApiOperation({ summary: 'Assign a role to a user (admin only)' })
  @ApiBody({
    schema: {
      properties: {
        role: { type: 'string' },
        permissions: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async assignRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { role: string; permissions?: string[] },
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.assignRole(userId, body.role, body.permissions ?? [], actor.sub);
  }

  // ------------------------------------------------------------------
  // FRAUD & TRUST SAFETY
  // ------------------------------------------------------------------

  @Get('fraud/signals')
  @ApiTags('trust-safety')
  @ApiOperation({ summary: 'High-risk orders and users flagged by fraud engine' })
  @ApiQuery({ name: 'riskLevel', required: false, enum: ['HIGH', 'MEDIUM'] })
  @ApiQuery({ name: 'page', required: false })
  async getFraudSignals(@Query('riskLevel') riskLevel?: string, @Query('page') page = 1) {
    return this.adminService.getFraudSignals(riskLevel, Number(page));
  }

  @Get('fraud/chargeback-rate')
  @ApiTags('trust-safety')
  @ApiOperation({ summary: 'Payment chargeback rate over time' })
  async getChargebackRate(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminService.getChargebackRate(from, to);
  }

  // ------------------------------------------------------------------
  // CONTENT MODERATION
  // ------------------------------------------------------------------

  @Get('moderation/queue')
  @ApiTags('trust-safety')
  @ApiOperation({ summary: 'Products pending moderation review' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getModerationQueue(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.adminService.getModerationQueue(Number(page), Number(limit));
  }

  @Patch('moderation/:productId/approve')
  @ApiTags('trust-safety')
  @ApiOperation({ summary: 'Approve a product listing' })
  async approveProduct(@Param('productId', ParseUUIDPipe) productId: string, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.moderateProduct(productId, 'APPROVED', undefined, actor.sub);
  }

  @Patch('moderation/:productId/reject')
  @ApiTags('trust-safety')
  @ApiBody({ schema: { properties: { reason: { type: 'string' } } } })
  @ApiOperation({ summary: 'Reject a product listing with reason' })
  async rejectProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body('reason') reason: string,
    @Req() req: Request,
  ) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.moderateProduct(productId, 'REJECTED', reason, actor.sub);
  }

  // ------------------------------------------------------------------
  // FINANCE / PAYOUTS
  // ------------------------------------------------------------------

  @Get('finance/revenue')
  @ApiTags('finance')
  @ApiOperation({ summary: 'Platform revenue breakdown: commission + ads + subscriptions' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getRevenueSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminService.getRevenueSummary(from, to);
  }

  @Get('finance/payouts')
  @ApiTags('finance')
  @ApiOperation({ summary: 'Seller payout queue — pending disbursements' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  })
  @ApiQuery({ name: 'page', required: false })
  async getPayouts(@Query('status') status?: string, @Query('page') page = 1) {
    return this.adminService.getPayouts(status, Number(page));
  }

  @Post('finance/payouts/:id/process')
  @HttpCode(HttpStatus.OK)
  @ApiTags('finance')
  @ApiOperation({ summary: 'Trigger payout processing for a pending disbursement' })
  async processPayout(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = (req as unknown as Record<string, unknown>)['adminUser'] as { sub: string };
    return this.adminService.processPayout(id, actor.sub);
  }

  // ------------------------------------------------------------------
  // SYSTEM HEALTH
  // ------------------------------------------------------------------

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiTags('system')
  @ApiOperation({ summary: 'Admin service health check' })
  @ApiResponse({ status: 200, description: 'OK' })
  async health() {
    return { status: 'ok', service: 'admin-service', ts: new Date().toISOString() };
  }

  @Get('system/metrics')
  @ApiTags('system')
  @ApiOperation({ summary: 'Real-time system metrics: DB pool, Redis, queue depths' })
  async getSystemMetrics() {
    return this.adminService.getSystemMetrics();
  }

  @Get('system/service-health')
  @ApiTags('system')
  @ApiOperation({ summary: 'Health status of all downstream microservices' })
  async getServiceHealth() {
    return this.adminService.getServiceHealthStatus();
  }
}
