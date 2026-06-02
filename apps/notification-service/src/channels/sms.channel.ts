// ============================================================
// HYPERCOMMERCE — SMS Channel (Twilio)
// OTP, order alerts, critical notifications via SMS.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const Twilio = require('twilio');
import { RedisClientService } from '@hypercommerce/redis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

export interface SmsPayload {
  userId: string;
  message: string;
  phoneNumber?: string; // Override if already known
}

import { INotificationChannel, NotificationPayload, DeliveryResult } from './interfaces/notification-channel.interface';

@Injectable()
export class SmsChannel implements INotificationChannel {
  readonly channelName = 'SMS';
  private readonly logger = new Logger(SmsChannel.name);
  private readonly client: ReturnType<typeof Twilio> | null = null;
  private readonly fromNumber: string;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisClientService,
  ) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_FROM_NUMBER', '');

    if (sid && token) {
      this.client = Twilio(sid, token);
    }
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    if (!this.client) return { channel: 'SMS', success: false, errorCode: 'NOT_CONFIGURED' };

    const phone = await this.getUserPhone(payload.userId);
    if (!phone) return { channel: 'SMS', success: false, errorCode: 'NO_PHONE' };

    // Rate limit: max 3 SMS per hour per user (cost control + anti-spam)
    const rateLimitKey = `sms:rl:${payload.userId}`;
    const count = await (this.redis.getClient() as import('ioredis').Redis).incr(rateLimitKey);
    if (count === 1) {
      await (this.redis.getClient() as import('ioredis').Redis).expire(rateLimitKey, 3600);
    }
    if (count > 3) {
      this.logger.warn(`SMS rate limit exceeded for user ${payload.userId}`);
      return { channel: 'SMS', success: false, errorCode: 'RATE_LIMITED' };
    }

    await this.client.messages.create({
      body: payload.body,
      from: this.fromNumber,
      to: phone,
    });
    return { channel: 'SMS', success: true };
  }

  async canSend(_userId: string, _notificationType: string): Promise<boolean> {
    return !!this.client;
  }

  /**
   * Send OTP for 2FA or payment verification.
   * OTP stored in Redis with 5-minute TTL.
   */
  async sendOtp(userId: string, phone: string, purpose: string): Promise<void> {
    const otp = this.generateOtp();
    const otpKey = `otp:${purpose}:${userId}`;

    // Store hashed OTP (not plaintext) — brute force protection
    const { createHash } = await import('crypto');
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await (this.redis.getClient() as import('ioredis').Redis).set(otpKey, otpHash, 'EX', 300);

    await this.send({
      userId,
      title: 'OTP',
      body: `[HyperCommerce] Mã OTP của bạn: ${otp}. Hiệu lực 5 phút. Không chia sẻ mã này.`,
      message: `[HyperCommerce] Mã OTP của bạn: ${otp}. Hiệu lực 5 phút. Không chia sẻ mã này.`,
      phoneNumber: phone,
    });
  }

  async verifyOtp(userId: string, otp: string, purpose: string): Promise<boolean> {
    const otpKey = `otp:${purpose}:${userId}`;
    const { createHash } = await import('crypto');
    const otpHash = createHash('sha256').update(otp).digest('hex');

    const stored = await this.redis.get(otpKey);
    if (!stored || stored !== otpHash) return false;

    // Delete after use — one-time use
    await this.redis.del(otpKey);
    return true;
  }

  private generateOtp(): string {
    // 6-digit numeric OTP
    return Math.floor(100_000 + Math.random() * 900_000).toString();
  }

  private async getUserPhone(userId: string): Promise<string | null> {
    const cacheKey = `user:phone:${userId}`;
    return this.redis.get(cacheKey);
  }
}
