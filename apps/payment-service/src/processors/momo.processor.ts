import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { IPaymentProcessor, ChargeResult, RefundResult } from './interfaces/payment-processor.interface';

/**
 * MomoProcessor — MoMo e-wallet integration (Vietnam).
 *
 * MoMo is the #1 e-wallet in Vietnam with 30M+ users.
 * Uses RSA or HMAC-SHA256 for signature depending on API version.
 * Supports: QR code, deeplink (app-to-app), OTP.
 */
@Injectable()
export class MomoProcessor implements IPaymentProcessor {
  readonly processorType = 'MOMO';
  private readonly logger = new Logger(MomoProcessor.name);
  private readonly partnerCode: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly momoApiUrl: string;
  private readonly notifyUrl: string;
  private readonly returnUrl: string;

  constructor(private readonly config: ConfigService) {
    this.partnerCode = config.get<string>('MOMO_PARTNER_CODE', '');
    this.accessKey = config.get<string>('MOMO_ACCESS_KEY', '');
    this.secretKey = config.get<string>('MOMO_SECRET_KEY', '');
    this.momoApiUrl = config.get<string>('MOMO_API_URL', 'https://test-payment.momo.vn/v2/gateway/api/create');
    this.notifyUrl = config.get<string>('MOMO_NOTIFY_URL', 'https://api.hypercommerce.vn/payment/momo/webhook');
    this.returnUrl = config.get<string>('MOMO_RETURN_URL', 'https://app.hypercommerce.vn/payment/momo/return');
  }

  async charge(params: {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethodToken: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChargeResult> {
    const requestId = params.idempotencyKey;
    const orderInfo = `Thanh toan don hang ${params.orderId}`;
    const requestType = 'payWithMethod'; // QR / deeplink

    // Build signature string
    const rawSignature = [
      `accessKey=${this.accessKey}`,
      `amount=${params.amount}`,
      `extraData=`,
      `ipnUrl=${this.notifyUrl}`,
      `orderId=${params.orderId}`,
      `orderInfo=${orderInfo}`,
      `partnerCode=${this.partnerCode}`,
      `redirectUrl=${this.returnUrl}`,
      `requestId=${requestId}`,
      `requestType=${requestType}`,
    ].join('&');

    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(rawSignature)
      .digest('hex');

    const body = {
      partnerCode: this.partnerCode,
      partnerName: 'HYPERCOMMERCE',
      storeId: 'HyperStore',
      requestId,
      amount: params.amount,
      orderId: params.orderId,
      orderInfo,
      redirectUrl: this.returnUrl,
      ipnUrl: this.notifyUrl,
      lang: 'vi',
      requestType,
      autoCapture: true,
      extraData: '',
      orderGroupId: '',
      signature,
    };

    // In real impl: await fetch(this.momoApiUrl, { method: 'POST', body: JSON.stringify(body) })
    this.logger.log(`MoMo payment request created for order ${params.orderId}`);

    return {
      processorReference: requestId,
      status: 'PENDING',
      rawResponse: { momoRequest: body },
    };
  }

  async refund(params: {
    processorReference: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    this.logger.log(`MoMo refund for ${params.processorReference}`);
    return {
      refundReference: `momo_refund_${params.idempotencyKey}`,
      status: 'PENDING_REFUND',
      processedAt: new Date(),
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    try {
      const data = JSON.parse(payload.toString()) as Record<string, unknown>;
      const rawSignature = [
        `accessKey=${this.accessKey}`,
        `amount=${data['amount']}`,
        `extraData=${data['extraData'] ?? ''}`,
        `message=${data['message']}`,
        `orderId=${data['orderId']}`,
        `orderInfo=${data['orderInfo']}`,
        `orderType=${data['orderType']}`,
        `partnerCode=${this.partnerCode}`,
        `payType=${data['payType']}`,
        `requestId=${data['requestId']}`,
        `responseTime=${data['responseTime']}`,
        `resultCode=${data['resultCode']}`,
        `transId=${data['transId']}`,
      ].join('&');

      const computed = crypto
        .createHmac('sha256', this.secretKey)
        .update(rawSignature)
        .digest('hex');

      return computed === signature;
    } catch {
      return false;
    }
  }
}
