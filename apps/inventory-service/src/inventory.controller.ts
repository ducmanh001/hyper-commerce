import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { JwtPayload } from '@hypercommerce/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, Roles } from '@hypercommerce/common';
import type { InventoryService } from './inventory.service';
import type { StockRepository } from './repositories/stock.repository';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly stockRepo: StockRepository,
  ) {}

  @Get()
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'List all products with stock levels' })
  async listStocks(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.stockRepo.findAll({ page: Number(page), limit: Number(limit) });
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get stock for a specific product' })
  async getStock(@Param('productId') productId: string, @Query('variantId') variantId?: string) {
    return this.stockRepo.findByProductId(productId, variantId);
  }

  @Get('low-stock')
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Get products below low-stock threshold' })
  async getLowStock() {
    return this.stockRepo.findLowStock();
  }

  @Post('reserve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reserve stock for an order (internal — called by order-service)' })
  async reserveStock(
    @Body()
    body: {
      orderId: string;
      items: Array<{ productId: string; variantId?: string; quantity: number }>;
      idempotencyKey: string;
    },
  ) {
    return this.inventoryService.reserveStock({
      orderId: body.orderId,
      items: body.items,
    });
  }

  @Post('release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release reserved stock (order cancelled/failed)' })
  async releaseStock(@Body() body: { orderId: string }) {
    return this.inventoryService.releaseReservation(body.orderId);
  }

  @Patch('product/:productId/adjust')
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Manually adjust stock level (seller receives new goods)' })
  async adjustStock(
    @Param('productId') productId: string,
    @Body() body: { quantity: number; reason: string; variantId?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.inventoryService.getStock(productId, body.variantId);
  }
}
