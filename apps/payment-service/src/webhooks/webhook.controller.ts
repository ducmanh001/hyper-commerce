import { Controller, Post, Body, HttpCode, HttpStatus, Logger, Headers, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { PaymentProcessorFactory } from '../processors/payment-processor.factory';
import type { PaymentRepository } from '../repositories/payment.repository';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * WebhookController — receives callbacks from payment gateways.
 *
 * CRITICAL: Verify signature BEFORE processing anything.
 * Use raw body (not parsed JSON) for signature verification.
 * Respond 200 immediately — process async via Kafka.
 */
@ApiTags('payment-webhooks')
@Controller('webhooks/payment')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly processorFactory: PaymentProcessorFactory,
    private readonly paymentRepo: PaymentRepository,
    private readonly kafka: KafkaProducerService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async handleStripe(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const processor = this.processorFactory.getByProcessorType('STRIPE');

    if (!processor?.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Stripe webhook signature verification failed');
      return { received: false };
    }

    const event = JSON.parse(rawBody.toString()) as {
      type: string;
      data: { object: { metadata?: { orderId?: string }; id?: string; amount_received?: number } };
    };
    this.logger.log(`Stripe webhook: ${event.type}`);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      await this.kafka.publish({
        topic: 'payment.captured',
        partitionKey: intent.metadata?.orderId,
        value: {
          eventId: uuidv4(),
          eventType: 'PAYMENT_CAPTURED',
          occurredAt: new Date().toISOString(),
          traceId: uuidv4(),
          version: 1,
          orderId: intent.metadata?.orderId ?? '',
          processorReference: intent.id ?? '',
          amount: intent.amount_received ?? 0,
        },
      });
    }

    return { received: true };
  }

  @Post('vnpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'VNPay IPN webhook endpoint' })
  async handleVnpay(@Body() body: Record<string, string>) {
    const processor = this.processorFactory.getByProcessorType('VNPAY');
    const isValid = (
      processor as { verifyIpn?: (p: Record<string, string>) => boolean }
    )?.verifyIpn?.(body);

    if (!isValid) {
      this.logger.warn('VNPay IPN signature invalid');
      return { RspCode: '97', Message: 'Invalid Signature' };
    }

    if (body['vnp_ResponseCode'] === '00') {
      await this.kafka.publish({
        topic: 'payment.captured',
        partitionKey: body['vnp_TxnRef'],
        value: {
          eventId: uuidv4(),
          eventType: 'PAYMENT_CAPTURED',
          occurredAt: new Date().toISOString(),
          traceId: uuidv4(),
          version: 1,
          orderId: body['vnp_TxnRef'] ?? '',
          processorReference: body['vnp_TransactionNo'] ?? '',
          amount: parseInt(body['vnp_Amount'] ?? '0', 10) / 100,
          currency: 'VND',
        },
      });
    }

    return { RspCode: '00', Message: 'Confirm Success' };
  }

  @Post('momo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MoMo IPN webhook endpoint' })
  async handleMomo(@Req() req: Request, @Headers('x-momo-signature') signature: string) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const processor = this.processorFactory.getByProcessorType('MOMO');

    if (!processor?.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('MoMo webhook signature invalid');
      return { resultCode: 9000 };
    }

    const data = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    if (data['resultCode'] === 0) {
      await this.kafka.publish({
        topic: 'payment.captured',
        partitionKey: data['orderId'] as string,
        value: {
          eventId: uuidv4(),
          eventType: 'PAYMENT_CAPTURED',
          occurredAt: new Date().toISOString(),
          traceId: uuidv4(),
          version: 1,
          orderId: data['orderId'],
          processorReference: data['transId'],
          amount: data['amount'],
          currency: 'VND',
        },
      });
    }

    return { resultCode: 0 };
  }
}
