import {
  Controller, Post, Get, Param, Body,
  ParseUUIDPipe, HttpCode, HttpStatus, UseGuards, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard, CurrentUser, JwtPayload } from '@hypercommerce/common';
import { PaymentService } from './payment.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get payment status for an order' })
  async getPaymentByOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentService.getPaymentByOrderId(orderId, user.sub);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request refund for a payment' })
  async refund(
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() body: { amount?: number; reason: string; idempotencyKey: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentService.refund({
      paymentId,
      userId: user.sub,
      amount: body.amount,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
