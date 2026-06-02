import { Injectable } from '@nestjs/common';
import { EmailChannel } from './email.channel';
import { SmsChannel } from './sms.channel';
import { PushChannel } from './push.channel';
import { InAppChannel } from './in-app.channel';
import type { INotificationChannel } from './interfaces/notification-channel.interface';

export type NotificationPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/**
 * ChannelFactory — Strategy Factory for selecting notification channels.
 *
 * Priority → channels mapping:
 * CRITICAL:  SMS + Push + Email + In-App (all channels, simultaneous)
 * HIGH:      Push + In-App + Email
 * NORMAL:    In-App + Email (async queue)
 * LOW:       In-App only (digest)
 *
 * Why fan-out to multiple channels vs single channel?
 * - Push may not be delivered if device offline for > 28 days
 * - Email deliverability ≠ read (spam folder)
 * - SMS is most reliable for CRITICAL alerts
 * - In-App is the catch-all fallback
 */
@Injectable()
export class ChannelFactory {
  private readonly channelMap = new Map<string, INotificationChannel>();

  constructor(
    private readonly emailChannel: EmailChannel,
    private readonly smsChannel: SmsChannel,
    private readonly pushChannel: PushChannel,
    private readonly inAppChannel: InAppChannel,
  ) {
    this.channelMap.set('EMAIL', emailChannel);
    this.channelMap.set('SMS', smsChannel);
    this.channelMap.set('PUSH', pushChannel);
    this.channelMap.set('IN_APP', inAppChannel);
  }

  /**
   * Returns ordered list of channels for the given priority.
   * Caller iterates and calls send() on each.
   */
  getChannels(priority: NotificationPriority): INotificationChannel[] {
    switch (priority) {
      case 'CRITICAL':
        return [this.smsChannel, this.pushChannel, this.emailChannel, this.inAppChannel];
      case 'HIGH':
        return [this.pushChannel, this.emailChannel, this.inAppChannel];
      case 'NORMAL':
        return [this.inAppChannel, this.emailChannel];
      case 'LOW':
        return [this.inAppChannel];
    }
  }

  getChannel(name: string): INotificationChannel | undefined {
    return this.channelMap.get(name.toUpperCase());
  }
}
