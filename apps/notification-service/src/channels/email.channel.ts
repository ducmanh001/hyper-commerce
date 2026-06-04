// ============================================================
// HYPERCOMMERCE — Email Channel (SendGrid)
// Transactional emails: order confirmation, invoices, promotions.
// HTML templates with i18n support (VI/EN).
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sgMail = require('@sendgrid/mail');

import type {
  INotificationChannel,
  NotificationPayload,
  DeliveryResult,
} from './interfaces/notification-channel.interface';

// SendGrid dynamic template IDs — managed in SendGrid dashboard
const TEMPLATE_IDS: Record<string, string> = {
  ORDER_CONFIRMED: 'd-order-confirmed-template-id',
  ORDER_CANCELLED: 'd-order-cancelled-template-id',
  PAYMENT_FAILED: 'd-payment-failed-template-id',
  FLASH_SALE_WIN: 'd-flash-sale-win-template-id',
  REVIEW_REQUEST: 'd-review-request-template-id',
  WELCOME: 'd-welcome-template-id',
};

@Injectable()
export class EmailChannel implements INotificationChannel {
  readonly channelName = 'EMAIL';
  private readonly logger = new Logger(EmailChannel.name);
  private readonly fromEmail: string;
  private initialized = false;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    this.fromEmail = this.config.get<string>('SENDGRID_FROM_EMAIL', 'noreply@hypercommerce.com');

    if (apiKey) {
      sgMail.setApiKey(apiKey);
      this.initialized = true;
    }
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    if (!this.initialized)
      return { channel: 'EMAIL', success: false, errorCode: 'NOT_INITIALIZED' };

    const toEmail = await this.getUserEmail(payload.userId);
    if (!toEmail) return { channel: 'EMAIL', success: false, errorCode: 'NO_EMAIL' };

    const templateId = (payload.data?.['template'] as string | undefined)
      ? TEMPLATE_IDS[payload.data!['template'] as string]
      : undefined;

    const msg = templateId
      ? {
          to: toEmail,
          from: this.fromEmail,
          templateId,
          dynamicTemplateData: (payload.data ?? {}) as Record<string, string>,
        }
      : {
          to: toEmail,
          from: this.fromEmail,
          subject: payload.title,
          text: payload.body,
          html: `<p>${payload.body.replace(/\n/g, '<br>')}</p>`,
        };

    await sgMail.send(msg);
    return { channel: 'EMAIL', success: true };
  }

  async canSend(_userId: string, _notificationType: string): Promise<boolean> {
    return this.initialized;
  }

  private async getUserEmail(userId: string): Promise<string | null> {
    // In production: cache user email in Redis to avoid DB call per notification
    return null;
  }
}
