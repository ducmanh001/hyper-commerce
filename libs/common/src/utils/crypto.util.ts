// ============================================================
// HYPERCOMMERCE — Crypto Utilities
// Secure cryptographic operations for the platform.
// OWASP Top 10 compliant: no MD5/SHA1, proper salt rounds.
// ============================================================

import { createHash, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { promisify } from 'util';
import * as bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12; // OWASP: >= 10 rounds for bcrypt
const IDEMPOTENCY_KEY_LENGTH = 32;

/**
 * Hash a password with bcrypt (adaptive — grows with hardware).
 * Never use MD5/SHA1 for passwords — not designed for it.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify password using constant-time comparison.
 * Prevents timing attacks.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Generate cryptographically secure random token.
 * Usage: email verification, password reset, API keys.
 *
 * NOT Math.random() — predictable, not cryptographically secure.
 */
export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * Generate idempotency key for payment operations.
 * Combines user context with randomness to avoid collisions.
 */
export function generateIdempotencyKey(prefix: string): string {
  const random = randomBytes(IDEMPOTENCY_KEY_LENGTH).toString('base64url');
  return `${prefix}_${random}`;
}

/**
 * HMAC-SHA256 signature for webhook verification (Stripe, etc).
 * Constant-time comparison prevents timing attacks.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  // timingSafeEqual requires same-length buffers
  if (expected.length !== signature.length) return false;

  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );
}

/**
 * Deterministic hash for cache keys (not for security).
 * Usage: product cache key from complex query params.
 */
export function hashForCache(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64url').slice(0, 16);
}

/**
 * Mask sensitive data for logging.
 * Usage: mask card number, email, phone in logs.
 */
export function maskSensitive(value: string, type: 'card' | 'email' | 'phone'): string {
  switch (type) {
    case 'card':
      // Show last 4: ****-****-****-1234
      return `****-****-****-${value.slice(-4)}`;
    case 'email': {
      const [local, domain] = value.split('@');
      return `${local?.slice(0, 2)}***@${domain}`;
    }
    case 'phone':
      // Show last 3: +84-***-***-123
      return `${value.slice(0, 3)}***${value.slice(-3)}`;
    default:
      return '***';
  }
}

/**
 * Base64URL encode (URL-safe, no padding).
 * Used for cursor tokens, signed URLs.
 */
export function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}
