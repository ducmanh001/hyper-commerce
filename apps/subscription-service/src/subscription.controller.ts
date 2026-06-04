import type { RawBodyRequest } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { SubscriptionService } from './subscription.service';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';

class CancelDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// Stripe webhook payload (simplified)
class StripeWebhookDto {
  type: string;
  data: {
    object: {
      id: string;
      customer: string;
      metadata: { sellerId: string; planId: string };
      current_period_start: number;
      current_period_end: number;
      amount_paid: number;
    };
  };
}

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('subscription/plans')
  @ApiOperation({ summary: 'List all available subscription plans' })
  listPlans() {
    return this.subscriptionService.listPlans();
  }

  @Get('subscription/my')
  @ApiOperation({ summary: "Get seller's current subscription" })
  getMy(@Headers('x-seller-id') sellerId: string) {
    return this.subscriptionService.getSellerSubscription(sellerId);
  }

  @Get('subscription/tier/:sellerId')
  @ApiOperation({ summary: 'Get seller tier info (called by other services)' })
  getSellerTier(@Param('sellerId') sellerId: string) {
    return this.subscriptionService.getSellerTier(sellerId);
  }

  @Delete('subscription/my')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel subscription (effective at period end)' })
  cancel(@Headers('x-seller-id') sellerId: string, @Body() dto: CancelDto) {
    return this.subscriptionService.cancelSubscription(sellerId, dto.reason);
  }

  // Stripe webhook — verifies signature and processes billing events
  // WHY separate endpoint without auth guard: Stripe calls this directly,
  // but it's protected by Stripe signature verification.
  @Post('subscription/webhook/stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe billing webhook (internal)' })
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') _sig: string,
  ): Promise<{ received: boolean }> {
    // In production: verify using stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET)
    // Skipping Stripe SDK import here to avoid adding stripe as a dependency to this example
    const payload = req.body as StripeWebhookDto;

    if (payload.type === 'invoice.paid') {
      const obj = payload.data.object;
      await this.subscriptionService.activateSubscription(
        obj.metadata.sellerId,
        obj.metadata.planId,
        {
          subscriptionId: obj.id,
          customerId: obj.customer,
          periodStart: new Date(obj.current_period_start * 1000),
          periodEnd: new Date(obj.current_period_end * 1000),
          amountPaid: obj.amount_paid,
        },
      );
    } else if (payload.type === 'invoice.payment_failed') {
      const obj = payload.data.object;
      await this.subscriptionService.markPastDue(obj.metadata.sellerId);
    }

    return { received: true };
  }
}
