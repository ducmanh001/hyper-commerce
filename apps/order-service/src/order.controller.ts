import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@hypercommerce/common';
import { RolesGuard } from '@hypercommerce/common';
import type { JwtPayload } from '@hypercommerce/common';
import { CurrentUser } from '@hypercommerce/common';
import { Roles } from '@hypercommerce/common';
import type { CursorPaginationDto } from '@hypercommerce/common';
import type { OrderService } from './order.service';
import type { OrderQueryService } from './services/order-query.service';
import type { DisputeService } from './services/dispute.service';
import type { CommissionService } from './services/commission.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import type {
  CreateDisputeDto,
  ResolveDisputeDto,
  SellerDisputeResponseDto,
} from './dto/dispute.dto';
import { OrderOwnershipGuard } from './guards/order-ownership.guard';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly orderQueryService: OrderQueryService,
    private readonly disputeService: DisputeService,
    private readonly commissionService: CommissionService,
  ) {}

  // ── CREATE ────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new order (server-verified prices)' })
  @ApiResponse({ status: 201, description: 'Order created', type: OrderResponseDto })
  @ApiResponse({ status: 409, description: 'Price mismatch or duplicate order' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrderResponseDto> {
    return this.orderService.createOrder(dto, user.sub);
  }

  // ── READ ──────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List my orders (cursor pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  async listMyOrders(@CurrentUser() user: JwtPayload, @Query() pagination: CursorPaginationDto) {
    return this.orderQueryService.findByUserId(user.sub, pagination);
  }

  @Get('seller')
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Seller order list' })
  async listSellerOrders(
    @CurrentUser() user: JwtPayload,
    @Query() pagination: CursorPaginationDto,
  ) {
    if (!user.sellerId) return { items: [], nextCursor: null, total: 0 };
    return this.orderQueryService.findBySellerId(user.sellerId, pagination);
  }

  @Get(':id')
  @UseGuards(OrderOwnershipGuard)
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async getOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrderResponseDto> {
    return this.orderQueryService.findOneOrFail(id, user.sub);
  }

  // ── UPDATE ────────────────────────────────────────────────

  @Patch(':id/status')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Admin: manually transition order status' })
  async updateOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orderService.transitionState(id, dto.transition);
  }

  // ── CANCEL ────────────────────────────────────────────────

  @Delete(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OrderOwnershipGuard)
  @ApiOperation({ summary: 'Cancel an order (user-initiated)' })
  async cancelOrder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.cancelOrder(id, user.sub, 'USER_REQUESTED');
  }

  // ── DISPUTES ──────────────────────────────────────────────

  @Post(':id/disputes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OrderOwnershipGuard)
  @ApiOperation({ summary: 'Open a dispute for a delivered order' })
  @ApiResponse({ status: 201, description: 'Dispute opened' })
  @ApiResponse({ status: 409, description: 'Outside dispute window or dispute already exists' })
  async openDispute(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateDisputeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.disputeService.openDispute(orderId, user.sub, dto);
  }

  @Get(':id/disputes')
  @UseGuards(OrderOwnershipGuard)
  @ApiOperation({ summary: 'Get all disputes for an order' })
  async getOrderDisputes(@Param('id', ParseUUIDPipe) orderId: string) {
    return this.disputeService.getDisputesByOrder(orderId);
  }

  @Post('disputes/:disputeId/seller-response')
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Seller responds to a dispute' })
  async sellerRespondToDispute(
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: SellerDisputeResponseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.disputeService.sellerRespond(disputeId, user.sellerId ?? user.sub, dto);
  }

  @Patch('disputes/:disputeId/resolve')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'CS Admin: resolve a dispute' })
  async resolveDispute(
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.disputeService.resolveDispute(disputeId, user.sub, dto);
  }

  @Get('my/disputes')
  @ApiOperation({ summary: 'List my open disputes' })
  async getMyDisputes(@CurrentUser() user: JwtPayload) {
    return this.disputeService.getDisputesByBuyer(user.sub);
  }

  // ── COMMISSION (seller) ───────────────────────────────────

  @Get('seller/commission-summary')
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Seller commission & earnings summary' })
  @ApiQuery({ name: 'from', required: true, example: '2024-01-01' })
  @ApiQuery({ name: 'to', required: true, example: '2024-01-31' })
  async getSellerCommission(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const sellerId = user.sellerId ?? user.sub;
    return this.commissionService.getSellerCommissionSummary(
      sellerId,
      new Date(from),
      new Date(to),
    );
  }

  // ── STATS (admin) ─────────────────────────────────────────

  @Get('admin/stats')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Order statistics dashboard (admin)' })
  async getOrderStats(@Query('from') from: string, @Query('to') to: string) {
    return this.orderQueryService.getStats(from, to);
  }
}
