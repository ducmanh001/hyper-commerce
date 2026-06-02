/**
 * RBAC / ABAC Permission Definitions
 *
 * Model: Role-Based Access Control with Attribute-Based extensions.
 * - Roles define coarse-grained access (WHO can do WHAT on WHICH subjects)
 * - Conditions add attribute-based checks (e.g. seller can only read own orders)
 *
 * Implementation: CASL (@casl/ability) — the de-facto NestJS permission library.
 * Pure-function permission rules → easy to test, serialise, and cache.
 *
 * Subjects match TypeORM entity names; actions follow CASL conventions.
 */

/** All business subjects (keep in sync with entity class names) */
export type AppSubjects =
  | 'User'
  | 'Seller'
  | 'Order'
  | 'OrderItem'
  | 'Dispute'
  | 'Product'
  | 'Campaign'         // ads
  | 'AdImpression'
  | 'Subscription'
  | 'Payment'
  | 'Payout'
  | 'Commission'
  | 'Notification'
  | 'AuditLog'
  | 'FeatureFlag'
  | 'Report'
  | 'SystemConfig'
  | 'all';             // CASL wildcard — "everything"

/** Coarse actions — expanded from CRUD to cover business operations */
export type AppActions =
  | 'manage'      // wildcard: all actions
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'approve'     // seller verification, dispute resolution
  | 'reject'
  | 'ban'         // suspend user / seller
  | 'unban'
  | 'export'      // download CSV/Excel
  | 'impersonate' // support: log in as another user
  | 'refund'
  | 'payout'
  | 'configure';  // system config / feature flags

/**
 * Platform roles — ordered from most to least privileged.
 * SUPER_ADMIN: granted out-of-band (env var); never stored in DB.
 */
export enum Role {
  SUPER_ADMIN   = 'SUPER_ADMIN',
  ADMIN         = 'ADMIN',
  OPS           = 'OPS',             // operations / CS team
  FINANCE       = 'FINANCE',
  TRUST_SAFETY  = 'TRUST_SAFETY',    // content moderation + fraud
  SELLER        = 'SELLER',
  BUYER         = 'BUYER',
  GUEST         = 'GUEST',
}

/** Hierarchy: higher index ≥ lower index permissions */
export const ROLE_HIERARCHY: Record<Role, Role[]> = {
  [Role.SUPER_ADMIN]:  Object.values(Role),
  [Role.ADMIN]:        [Role.ADMIN, Role.OPS, Role.FINANCE, Role.TRUST_SAFETY, Role.SELLER, Role.BUYER, Role.GUEST],
  [Role.OPS]:          [Role.OPS, Role.SELLER, Role.BUYER, Role.GUEST],
  [Role.FINANCE]:      [Role.FINANCE],
  [Role.TRUST_SAFETY]: [Role.TRUST_SAFETY],
  [Role.SELLER]:       [Role.SELLER],
  [Role.BUYER]:        [Role.BUYER],
  [Role.GUEST]:        [Role.GUEST],
};

/** JWT payload shape — extended with RBAC fields */
export interface JwtPayload {
  sub: string;         // userId
  email: string;
  role: Role;
  sellerId?: string;   // present when role === SELLER
  permissions?: string[]; // optional fine-grained overrides (stored in DB)
  iat?: number;
  exp?: number;
}
