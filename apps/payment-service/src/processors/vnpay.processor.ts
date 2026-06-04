import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as querystring from 'querystring';
import type {
  IPaymentProcessor,
  ChargeResult,
  RefundResult,
} from './interfaces/payment-processor.interface';

/**
 * VnpayProcessor — VNPay gateway integration (Vietnam).
 *
 * VNPay is the most common payment gateway in Vietnam.
 * Uses HMAC-SHA512 signature for security.
 * Flow: create payment URL → redirect → verify return URL → webhook confirm
 */
@Injectable()
export class VnpayProcessor implements IPaymentProcessor {
  readonly processorType = 'VNPAY';
  private readonly logger = new Logger(VnpayProcessor.name);
  private readonly tmnCode: string;
  private readonly hashSecret: string;
  private readonly vnpUrl: string;
  private readonly returnUrl: string;

  constructor(private readonly config: ConfigService) {
    this.tmnCode = config.get<string>('VNPAY_TMN_CODE', '');
    this.hashSecret = config.get<string>('VNPAY_HASH_SECRET', '');
    this.vnpUrl = config.get<string>(
      'VNPAY_URL',
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    );
    this.returnUrl = config.get<string>(
      'VNPAY_RETURN_URL',
      'https://app.hypercommerce.vn/payment/vnpay/return',
    );
  }

  async charge(params: {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethodToken: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChargeResult> {
    const now = new Date();
    const createDate = this.formatDate(now);
    const expireDate = this.formatDate(new Date(now.getTime() + 15 * 60 * 1000)); // 15 min

    const vnpParams: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: this.tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: params.idempotencyKey.substring(0, 20), // max 20 chars
      vnp_OrderInfo: `Thanh toan don hang ${params.orderId}`,
      vnp_OrderType: 'other',
      vnp_Amount: String(params.amount * 100), // VNPay uses *100
      vnp_ReturnUrl: this.returnUrl,
      vnp_IpAddr: '127.0.0.1',
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
    };

    const sorted = Object.keys(vnpParams)
      .sort()
      .reduce((acc, key) => ({ ...acc, [key]: vnpParams[key] }), {} as Record<string, string>);

    const signData = querystring.stringify(sorted);
    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const signature = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    sorted.vnp_SecureHash = signature;

    const paymentUrl = `${this.vnpUrl}?${querystring.stringify(sorted)}`;

    this.logger.log(`VNPay payment URL created for order ${params.orderId}`);

    // VNPay is redirect-based — return PENDING with payment URL
    return {
      processorReference: params.idempotencyKey,
      status: 'PENDING',
      rawResponse: { paymentUrl, txnRef: sorted.vnp_TxnRef },
    };
  }

  /**
   * Verify VNPay IPN (Instant Payment Notification).
   * Called from WebhookController when VNPay POSTs confirmation.
   */
  verifyIpn(params: Record<string, string>): boolean {
    const secureHash = params['vnp_SecureHash'];
    const paramsWithoutHash: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType') {
        paramsWithoutHash[k] = v;
      }
    }

    const sorted = Object.keys(paramsWithoutHash)
      .sort()
      .reduce((acc, k) => ({ ...acc, [k]: paramsWithoutHash[k] }), {} as Record<string, string>);
    const signData = querystring.stringify(sorted);
    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const calculatedHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    return calculatedHash === secureHash;
  }

  async refund(params: {
    processorReference: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    // VNPay refund via querydr API — simplified here
    this.logger.log(`VNPay refund requested for ${params.processorReference}`);
    return {
      refundReference: `vnpay_refund_${params.idempotencyKey}`,
      status: 'PENDING_REFUND',
      processedAt: new Date(),
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    const params = querystring.parse(payload.toString()) as Record<string, string>;
    return this.verifyIpn({ ...params, vnp_SecureHash: signature });
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace(/[-:T]/g, '').substring(0, 14);
  }
}
