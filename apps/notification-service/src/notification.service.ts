// ============================================================
// HYPERCOMMERCE — Notification Service
// Multi-channel dispatcher: Push, SMS, Email, WebSocket.
// Priority queues, template rendering, delivery tracking.
// ============================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import { Notification } from './entities/notification.entity';
import { PushChannel } from './channels/push.channel';
import { SmsChannel } from './channels/sms.channel';
import { EmailChannel } from './channels/email.channel';
import { RedisClientService } from '@hypercommerce/redis';

export type NotificationChannel = 'PUSH' | 'SMS' | 'EMAIL' | 'IN_APP';

export type NotificationType =
  | 'ORDER_CONFIRMED'
  | 'ORDER_CANCELLED'
  | 'PAYMENT_FAILED'
  | 'STOCK_ALERT'
  | 'FLASH_SALE_WIN'
  | 'FLASH_SALE_LOSE'
  | 'NEW_FOLLOWER'
  | 'STREAM_STARTING'
  | 'GIFT_RECEIVED'
  | 'REVIEW_REQUEST'
  | 'PROMOTION';

interface NotificationPayload {
  userId: string;
  type: NotificationType;
  channels: NotificationChannel[];
  title: string;
  body: string;
  imageUrl?: string;
  actionUrl?: string;
  data?: Record<string, string>;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
}

// Template registry — in production: stored in DB, hot-reloaded
const NOTIFICATION_TEMPLATES: Record<NotificationType, {
  title: (data: Record<string, string>) => string;
  body: (data: Record<string, string>) => string;
}> = {
  ORDER_CONFIRMED: {
    title: () => '✅ Đơn hàng đã xác nhận!',
    body: (d) => `Đơn #${d.orderId} - ${d.totalAmount}đ đang được chuẩn bị.`,
  },
  ORDER_CANCELLED: {
    title: () => '❌ Đơn hàng đã hủy',
    body: (d) => `Đơn #${d.orderId} bị hủy: ${d.reason}`,
  },
  PAYMENT_FAILED: {
    title: () => '⚠️ Thanh toán thất bại',
    body: (d) => `Đơn #${d.orderId}: ${d.declineReason}. Vui lòng thử lại.`,
  },
  STOCK_ALERT: {
    title: () => '📦 Hàng sắp hết!',
    body: (d) => `${d.productName} chỉ còn ${d.stockCount} cái.`,
  },
  FLASH_SALE_WIN: {
    title: () => '🎉 Bạn đã mua thành công!',
    body: (d) => `Flash sale: ${d.productName} - ${d.price}đ đã thuộc về bạn!`,
  },
  FLASH_SALE_LOSE: {
    title: () => '😢 Hết hàng rồi!',
    body: (d) => `${d.productName} flash sale đã bán hết. Đừng bỏ lỡ lần sau!`,
  },
  NEW_FOLLOWER: {
    title: () => '👤 Người theo dõi mới',
    body: (d) => `${d.followerName} đã theo dõi bạn.`,
  },
  STREAM_STARTING: {
    title: (d) => `🔴 ${d.sellerName} đang livestream!`,
    body: (d) => d.streamTitle,
  },
  GIFT_RECEIVED: {
    title: () => '🎁 Bạn nhận được quà!',
    body: (d) => `${d.senderName} gửi ${d.quantity}x ${d.giftName}`,
  },
  REVIEW_REQUEST: {
    title: () => '⭐ Đánh giá sản phẩm',
    body: (d) => `Bạn đã nhận ${d.productName}. Hãy để lại đánh giá!`,
  },
  PROMOTION: {
    title: (d) => d.title,
    body: (d) => d.body,
  },
};

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    private readonly consumer: KafkaConsumerService,
    private readonly redis: RedisClientService,
    private readonly push: PushChannel,
    private readonly sms: SmsChannel,
    private readonly email: EmailChannel,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer.registerConsumer({
      groupId: 'notification-consumer',
      topics: [
        APP_CONSTANTS.KAFKA_TOPICS.NOTIFICATION_DISPATCH,
        APP_CONSTANTS.KAFKA_TOPICS.ORDER_CONFIRMED,
        APP_CONSTANTS.KAFKA_TOPICS.ORDER_CANCELLED,
        APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_FAILED,
      ],
      handlers: [
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.NOTIFICATION_DISPATCH,
          handle: this.onNotificationDispatch.bind(this),
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CONFIRMED,
          handle: this.onOrderConfirmed.bind(this),
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.ORDER_CANCELLED,
          handle: this.onOrderCancelled.bind(this),
        },
        {
          topic: APP_CONSTANTS.KAFKA_TOPICS.PAYMENT_FAILED,
          handle: this.onPaymentFailed.bind(this),
        },
      ],
    }).catch((err: Error) => this.logger.warn(`Kafka consumer init failed: ${err.message}`));
  }

  /**
   * Dispatch notification via requested channels.
   * Respects user preferences (mute hours, channel opt-outs).
   */
  async dispatch(payload: NotificationPayload): Promise<void> {
    // Check user notification preferences
    const prefs = await this.getUserPreferences(payload.userId);
    if (!prefs.enabled) return;

    // Check quiet hours (22:00 - 08:00)
    if (this.isQuietHours() && payload.priority !== 'HIGH') {
      await this.scheduleForMorning(payload);
      return;
    }

    // Render from template
    const template = NOTIFICATION_TEMPLATES[payload.type];
    const rendered = {
      title: template.title(payload.data ?? {}),
      body: template.body(payload.data ?? {}),
    };

    // Persist notification record
    const notif = await this.notifRepo.save({
      userId: payload.userId,
      type: payload.type,
      title: rendered.title,
      body: rendered.body,
      channels: payload.channels,
      status: 'PENDING',
      data: payload.data,
    });

    // Dispatch to each channel in parallel
    const dispatches = payload.channels
      .filter((ch) => prefs.channels.includes(ch))
      .map((channel) => this.dispatchToChannel(channel, payload, rendered, notif.id));

    const results = await Promise.allSettled(dispatches);

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      this.logger.warn(
        JSON.stringify({
          event: 'notification_partial_failure',
          notifId: notif.id,
          failedCount: failed.length,
        }),
      );
    }

    await this.notifRepo.update(notif.id, {
      status: failed.length === results.length ? 'FAILED' : 'DELIVERED',
      deliveredAt: new Date(),
    });
  }

  private async dispatchToChannel(
    channel: NotificationChannel,
    payload: NotificationPayload,
    rendered: { title: string; body: string },
    notifId: string,
  ): Promise<void> {
    switch (channel) {
      case 'PUSH':
        await this.push.send({
          userId: payload.userId,
          title: rendered.title,
          body: rendered.body,
          imageUrl: payload.imageUrl,
          data: { ...payload.data, notifId, actionUrl: payload.actionUrl ?? '' },
        });
        break;
      case 'SMS':
        await this.sms.send({
          userId: payload.userId,
          title: rendered.title,
          body: rendered.body,
          message: `${rendered.title}\n${rendered.body}`,
        });
        break;
      case 'EMAIL':
        await this.email.send({
          userId: payload.userId,
          title: rendered.title,
          body: rendered.body,
          subject: rendered.title,
          template: payload.type,
          data: payload.data,
        });
        break;
      case 'IN_APP':
        // Stored in Redis for next app open
        await this.redis.lpush(
          `notif:inbox:${payload.userId}`,
          JSON.stringify({ title: rendered.title, body: rendered.body, notifId }),
        );
        break;
    }
  }

  // ── Kafka Handlers ────────────────────────────────────────

  private async onNotificationDispatch(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    if (event.type === 'FLASH_SALE_RESULT') {
      const won = event.won as boolean;
      await this.dispatch({
        userId: event.userId as string,
        type: won ? 'FLASH_SALE_WIN' : 'FLASH_SALE_LOSE',
        channels: ['PUSH', 'IN_APP'],
        title: '',
        body: '',
        priority: 'HIGH',
        data: {
          productName: event.productName as string ?? 'Sản phẩm',
          price: String(event.price ?? ''),
        },
      });
    }
  }

  private async onOrderConfirmed(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    if (event.type !== 'ORDER_CONFIRMED') return;
    // Fetch order details to get userId — cross-service call via HTTP/gRPC
    // Simplified here for clarity
    this.logger.log(
      JSON.stringify({ event: 'notif_order_confirmed', orderId: event.orderId }),
    );
  }

  private async onOrderCancelled(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    // Similar pattern...
  }

  private async onPaymentFailed(
    event: Record<string, unknown>,
    meta: MessageMetadata,
  ): Promise<void> {
    // Similar pattern...
  }

  // ── Helpers ───────────────────────────────────────────────

  private async getUserPreferences(userId: string): Promise<{
    enabled: boolean;
    channels: NotificationChannel[];
  }> {
    const key = `user:notif:prefs:${userId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as { enabled: boolean; channels: NotificationChannel[] };

    // Default preferences
    return { enabled: true, channels: ['PUSH', 'IN_APP'] };
  }

  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 8;
  }

  private async scheduleForMorning(payload: NotificationPayload): Promise<void> {
    // Store in delayed queue — processed at 8am
    const key = `notif:delayed:${payload.userId}`;
    await this.redis.lpush(key, JSON.stringify(payload));
    await this.redis.expire(key, 86_400);
  }
}
