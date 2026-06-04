import { Injectable } from '@nestjs/common';
import type { IPaymentProcessor } from './interfaces/payment-processor.interface';
import type { StripeProcessor } from './stripe.processor';
import type { VnpayProcessor } from './vnpay.processor';
import type { MomoProcessor } from './momo.processor';
import type { CodProcessor } from './cod.processor';

export type PaymentMethodType = 'STRIPE' | 'VNPAY' | 'MOMO' | 'COD' | 'BANK_TRANSFER';

/**
 * PaymentProcessorFactory — Strategy selector.
 * Open/Closed: add new gateway = new class + register here.
 */
@Injectable()
export class PaymentProcessorFactory {
  private readonly processors: Map<string, IPaymentProcessor>;

  constructor(
    private readonly stripeProcessor: StripeProcessor,
    private readonly vnpayProcessor: VnpayProcessor,
    private readonly momoProcessor: MomoProcessor,
    private readonly codProcessor: CodProcessor,
  ) {
    this.processors = new Map<string, IPaymentProcessor>([
      ['STRIPE', this.stripeProcessor],
      ['VNPAY', this.vnpayProcessor],
      ['MOMO', this.momoProcessor],
      ['COD', this.codProcessor],
    ]);
  }

  getProcessor(type: PaymentMethodType, currency?: string): IPaymentProcessor {
    if (!type || !this.processors.has(type)) {
      const fallback = currency === 'VND' ? 'VNPAY' : 'STRIPE';
      return this.processors.get(fallback)!;
    }
    return this.processors.get(type)!;
  }

  getByProcessorType(processorType: string): IPaymentProcessor | undefined {
    for (const p of this.processors.values()) {
      if (p.processorType === processorType) return p;
    }
    return undefined;
  }
}
