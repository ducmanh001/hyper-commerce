/**
 * Application Ports — interfaces the Application layer depends on
 * for external services (email, file storage, push notifications).
 *
 * WHY PORTS:
 *   The Application layer needs to send emails, but shouldn't know whether
 *   it's using SendGrid, SES, Resend, or a mock in tests.
 *   It depends on this interface (the port). Infrastructure provides the adapter.
 *
 *   Pattern: Hexagonal Architecture ("ports and adapters")
 *
 * INJECTION TOKENS: used because TypeScript interfaces are erased at runtime.
 */

// ── Notification Port ────────────────────────────────────────────────────────

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

export interface INotificationPort {
  sendWelcomeEmail(params: {
    toEmail: string;
    toName: string;
    verificationToken: string;
  }): Promise<void>;

  sendEmailVerification(params: {
    toEmail: string;
    toName: string;
    verificationToken: string;
  }): Promise<void>;

  sendPasswordResetEmail(params: {
    toEmail: string;
    toName: string;
    resetToken: string;
    expiresInMinutes: number;
  }): Promise<void>;

  sendSecurityAlert(params: {
    toEmail: string;
    eventType: 'new_login' | 'password_changed' | 'account_suspended';
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

// ── Cache Port ───────────────────────────────────────────────────────────────

export const USER_CACHE_PORT = Symbol('USER_CACHE_PORT');

export interface IUserCachePort {
  getProfile(userId: string): Promise<Record<string, unknown> | null>;
  setProfile(userId: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void>;
  invalidateProfile(userId: string): Promise<void>;

  /** Used for seen-items BloomFilter serialized state */
  getSeenItemsFilter(userId: string): Promise<Buffer | null>;
  setSeenItemsFilter(userId: string, filterBuffer: Buffer, ttlSeconds: number): Promise<void>;

  /** Token cache for email verification / password reset */
  setVerificationToken(token: string, userId: string, ttlSeconds: number): Promise<void>;
  getVerificationToken(token: string): Promise<string | null>;
  deleteVerificationToken(token: string): Promise<void>;
}

// ── File Storage Port ─────────────────────────────────────────────────────────

export const FILE_STORAGE_PORT = Symbol('FILE_STORAGE_PORT');

export interface IFileStoragePort {
  /**
   * Upload avatar.
   * @returns public URL of the uploaded image
   */
  uploadAvatar(params: { userId: string; buffer: Buffer; mimeType: string }): Promise<string>;

  deleteAvatar(userId: string): Promise<void>;
}

// ── Event Publisher Port ──────────────────────────────────────────────────────

export const USER_EVENT_PUBLISHER_PORT = Symbol('USER_EVENT_PUBLISHER_PORT');

import type { DomainEvent } from '@hypercommerce/common/domain/domain-event.base';

export interface IUserEventPublisherPort {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: DomainEvent[]): Promise<void>;
}

// ── Password Hasher Port ──────────────────────────────────────────────────────

export const PASSWORD_HASHER_PORT = Symbol('PASSWORD_HASHER_PORT');

export interface IPasswordHasherPort {
  hash(plainPassword: string): Promise<string>;
  verify(plainPassword: string, hash: string): Promise<boolean>;
}
