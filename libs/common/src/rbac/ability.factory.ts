/**
 * CASL AbilityFactory
 *
 * Why CASL?
 * - Isomorphic: same permission rules run on server (NestJS guards) and
 *   optionally on the client (hide UI elements based on ability).
 * - Declarative: rules read like English — can(read, Order).
 * - Condition support: sellers can only read their own orders.
 * - Performant: ruleset is built once per request and cached on the
 *   request object; O(1) permission checks via indexed rule storage.
 *
 * Pattern: Factory builds an Ability from JWT payload.
 * The Guard calls the factory, then @CheckAbility() decorators define
 * what each handler needs.
 */

import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
  ExtractSubjectType,
  InferSubjects,
} from '@casl/ability';
import { AppActions, AppSubjects, JwtPayload, Role } from './permissions';

export type AppAbility = MongoAbility<[AppActions, AppSubjects]>;

@Injectable()
export class AbilityFactory {
  /**
   * Build an AppAbility from the decoded JWT payload.
   * Called once per request inside CaslAbilityGuard.
   */
  createForUser(user: JwtPayload): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    switch (user.role) {
      // ── SUPER_ADMIN ─────────────────────────────────────────────────────
      case Role.SUPER_ADMIN:
        can('manage', 'all');
        break;

      // ── ADMIN ────────────────────────────────────────────────────────────
      case Role.ADMIN:
        can('manage', 'User');
        can('manage', 'Seller');
        can('manage', 'Order');
        can('manage', 'Dispute');
        can('manage', 'Product');
        can('manage', 'Campaign');
        can('manage', 'Subscription');
        can('manage', 'Payment');
        can('manage', 'Commission');
        can('manage', 'Notification');
        can('manage', 'AuditLog');
        can('manage', 'FeatureFlag');
        can('manage', 'Report');
        can('read',   'SystemConfig');
        cannot('configure', 'SystemConfig'); // only SUPER_ADMIN
        cannot('impersonate', 'User');       // sensitive — SUPER_ADMIN only
        break;

      // ── OPS (Customer Service) ───────────────────────────────────────────
      case Role.OPS:
        can(['read', 'update'], 'User');
        can(['read', 'update'], 'Order');
        can(['read', 'update', 'approve', 'reject'], 'Dispute');
        can(['read'], 'Payment');
        can(['read', 'refund'], 'Payment');
        can(['read'], 'Product');
        can(['read'], 'Seller');
        can(['read'], 'Commission');
        can(['read'], 'Notification');
        can(['read'], 'AuditLog');
        cannot('delete', 'User');
        cannot('ban',    'User');
        break;

      // ── FINANCE ──────────────────────────────────────────────────────────
      case Role.FINANCE:
        can(['read', 'export'], 'Report');
        can(['read', 'payout'], 'Payout');
        can(['read'],           'Commission');
        can(['read'],           'Payment');
        can(['read'],           'Subscription');
        cannot('update', 'User');
        cannot('update', 'Order');
        break;

      // ── TRUST & SAFETY ───────────────────────────────────────────────────
      case Role.TRUST_SAFETY:
        can(['read', 'update', 'approve', 'reject'], 'Product');
        can(['read', 'ban', 'unban'], 'User');
        can(['read', 'ban', 'unban'], 'Seller');
        can(['read', 'update'], 'Dispute');
        can(['read'], 'AuditLog');
        cannot('delete', 'Order');
        break;

      // ── SELLER ───────────────────────────────────────────────────────────
      case Role.SELLER:
        // Sellers manage their own products and campaigns
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['create', 'read', 'update', 'delete'], 'Product', { sellerId: user.sellerId } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['create', 'read', 'update'], 'Campaign',          { sellerId: user.sellerId } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read'],                     'Order',              { sellerId: user.sellerId } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read', 'update'],           'Dispute',            { sellerId: user.sellerId } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read'],                     'Commission',          { sellerId: user.sellerId } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read', 'update'],           'Subscription',       { sellerId: user.sellerId } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read'],                     'Payout',             { sellerId: user.sellerId } as any);
        break;

      // ── BUYER (default authenticated user) ──────────────────────────────
      case Role.BUYER:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['create', 'read'], 'Order',       { userId: user.sub } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read'],           'OrderItem',   { userId: user.sub } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['create', 'read'], 'Dispute',     { userId: user.sub } as any);
        can(['read'],           'Product');
        can(['read'],           'Seller');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read', 'update'], 'User',        { id: user.sub } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        can(['read', 'update'], 'Notification',{ userId: user.sub } as any);
        break;

      // ── GUEST ────────────────────────────────────────────────────────────
      default:
        can(['read'], 'Product');
        can(['read'], 'Seller');
        break;
    }

    // Apply any fine-grained permission overrides stored in DB
    if (user.permissions?.length) {
      for (const perm of user.permissions) {
        const [action, subject] = perm.split(':') as [AppActions, AppSubjects];
        if (action && subject) can(action, subject);
      }
    }

    return build({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detectSubjectType: (item: Record<PropertyKey, unknown>) =>
        item.constructor as unknown as ExtractSubjectType<InferSubjects<AppSubjects>>,
    });
  }
}
