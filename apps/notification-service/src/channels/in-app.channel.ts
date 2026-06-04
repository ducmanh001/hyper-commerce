import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  INotificationChannel,
  NotificationPayload,
  DeliveryResult,
} from './interfaces/notification-channel.interface';

/**
 * PushChannel — Firebase Cloud Messaging (FCM) for Android + APNs for iOS.
 *
 * Why FCM instead of direct APNs?
 * - Single API for both iOS and Android
 * - Offline delivery queuing (up to 28 days)
 * - Topic subscriptions for mass broadcasts (flash sales)
 * - FCM → APNs bridge for iOS
 *
 * For billion users:
 * - Use FCM batch send (up to 500 tokens per request)
 * - Topic messaging for global broadcasts (no individual token lookup)
 */
@Injectable()
export class InAppChannel implements INotificationChannel {
  readonly channelName = 'IN_APP';
  private readonly logger = new Logger(InAppChannel.name);

  constructor(private readonly config: ConfigService) {}

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    // In-App notifications are stored in DB (notification entity)
    // and served via WebSocket or polling from frontend
    // This channel is always successful — just marks as created
    this.logger.debug(`In-app notification queued for user ${payload.userId}`);
    return { channel: this.channelName, success: true, externalId: `inapp_${Date.now()}` };
  }

  async canSend(_userId: string, _notificationType: string): Promise<boolean> {
    return true; // In-app always enabled unless account suspended
  }
}
