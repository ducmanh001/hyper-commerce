// ============================================================
// HYPERCOMMERCE — Push Notification Channel
// Firebase Cloud Messaging (FCM) for iOS/Android push.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - package installed at runtime
import * as admin from 'firebase-admin';
import { RedisClientService } from '@hypercommerce/redis';

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
}

import { INotificationChannel, NotificationPayload, DeliveryResult } from './interfaces/notification-channel.interface';

@Injectable()
export class PushChannel implements INotificationChannel {
  readonly channelName = 'PUSH';
  private readonly logger = new Logger(PushChannel.name);
  private firebaseApp: admin.app.App | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisClientService,
  ) {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY', '').replace(/\\n/g, '\n');
    if (projectId && clientEmail && privateKey) {
      try {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        });
      } catch (err) {
        this.logger.warn(`Firebase Admin init failed: ${(err as Error).message}. Push notifications disabled.`);
      }
    }
  }

  /**
   * Send push notification to all devices of a user.
   * User can have multiple tokens (iOS, Android, Web).
   */
  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    if (!this.firebaseApp) return { channel: 'PUSH', success: false, errorCode: 'NOT_CONFIGURED' };

    const tokens = await this.getUserPushTokens(payload.userId);
    if (!tokens.length) return { channel: 'PUSH', success: false, errorCode: 'NO_TOKENS' };

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: payload.data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'hypercommerce_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging(this.firebaseApp).sendEachForMulticast(message);

    // Remove invalid/expired tokens
    const invalidTokens: string[] = [];
    response.responses.forEach((resp: { success: boolean; error?: { code: string } }, idx: number) => {
      if (!resp.success && resp.error) {
        const errCode = resp.error.code;
        if (
          errCode === 'messaging/registration-token-not-registered' ||
          errCode === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    if (invalidTokens.length) {
      await this.removeInvalidTokens(payload.userId, invalidTokens);
    }
    return { channel: 'PUSH', success: response.successCount > 0 };
  }

  async canSend(_userId: string, _notificationType: string): Promise<boolean> {
    return !!this.firebaseApp;
  }

  /**
   * Register a push token for a user.
   * Tokens are stored in Redis Set (dedup, O(1) add/remove).
   */
  async registerToken(userId: string, token: string): Promise<void> {
    const key = `push:tokens:${userId}`;
    await (this.redis.getClient() as import('ioredis').Redis).sadd(key, token);
    await (this.redis.getClient() as import('ioredis').Redis).expire(key, 86_400 * 90); // 90 days
  }

  private async getUserPushTokens(userId: string): Promise<string[]> {
    const key = `push:tokens:${userId}`;
    return (this.redis.getClient() as import('ioredis').Redis).smembers(key);
  }

  private async removeInvalidTokens(userId: string, tokens: string[]): Promise<void> {
    const key = `push:tokens:${userId}`;
    await (this.redis.getClient() as import('ioredis').Redis).srem(key, ...tokens);
  }
}
