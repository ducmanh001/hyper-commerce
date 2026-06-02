/**
 * BcryptPasswordHasher — bcrypt implementation of IPasswordHasherPort
 *
 * WHY IN INFRASTRUCTURE (not application layer):
 *   bcrypt is a specific implementation detail.
 *   The application layer only cares that passwords are "hashed securely".
 *   Tomorrow we could switch to argon2 — only this file changes.
 *
 * COST FACTOR 12:
 *   bcrypt slows down with cost factor (2^factor rounds).
 *   Cost 12 ≈ 400ms on a modern server. This is intentional — it makes
 *   brute-force attacks 400× more expensive.
 *   Cost 10 = 100ms (min acceptable), Cost 14 = 1.6s (too slow for login UX).
 *
 * TIMING ATTACKS:
 *   bcrypt.compare() has constant-time comparison built-in.
 *   Don't implement your own hash comparison with === (leaks timing info).
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - package installed at runtime
import * as bcrypt from 'bcrypt';
import { IPasswordHasherPort } from '../../application/ports/application.ports';

const BCRYPT_COST = 12;

@Injectable()
export class BcryptPasswordHasher implements IPasswordHasherPort {
  async hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, BCRYPT_COST);
  }

  async verify(plainPassword: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hash);
  }
}
