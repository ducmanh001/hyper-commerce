import { Injectable } from '@nestjs/common';

export interface RenderedTemplate {
  title: string;
  body: string;
}

@Injectable()
export class TemplateService {
  private readonly templates = new Map<string, {
    title: (data: Record<string, string>) => string;
    body: (data: Record<string, string>) => string;
  }>([
    ['ORDER_CONFIRMED', {
      title: (d) => `Order #${d['orderId'] ?? ''} confirmed`,
      body: (d) => `Your order of ${d['itemCount'] ?? ''} item(s) has been confirmed.`,
    }],
    ['ORDER_CANCELLED', {
      title: () => 'Order cancelled',
      body: (d) => `Order #${d['orderId'] ?? ''} has been cancelled.`,
    }],
    ['PAYMENT_FAILED', {
      title: () => 'Payment failed',
      body: (d) => `Payment for order #${d['orderId'] ?? ''} failed. Please retry.`,
    }],
  ]);

  render(type: string, data: Record<string, string> = {}): RenderedTemplate {
    const tpl = this.templates.get(type);
    if (!tpl) {
      return { title: data['title'] ?? type, body: data['body'] ?? '' };
    }
    return { title: tpl.title(data), body: tpl.body(data) };
  }
}
