/**
 * INotificationChannel — Strategy interface for all delivery channels.
 *
 * Channels: Email, SMS, Push (FCM/APNs), In-App
 *
 * ChannelFactory selects channels based on:
 * 1. User preferences (opt-in/out per channel per type)
 * 2. Notification priority (HIGH → SMS+Push, NORMAL → Email+In-App)
 * 3. User timezone (avoid 3AM SMS)
 */
export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  subject?: string;     // email subject line
  message?: string;     // SMS plain-text override
  template?: string;    // template name/type for email
  phoneNumber?: string; // SMS recipient override
  data?: Record<string, string>;
  imageUrl?: string;
  actionUrl?: string;
}

export interface DeliveryResult {
  channel: string;
  success: boolean;
  externalId?: string;
  errorCode?: string;
}

export interface INotificationChannel {
  readonly channelName: string;
  send(payload: NotificationPayload): Promise<DeliveryResult>;
  canSend(userId: string, notificationType: string): Promise<boolean>;
}
