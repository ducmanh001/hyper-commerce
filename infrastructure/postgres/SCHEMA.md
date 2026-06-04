# PostgreSQL Schema Snapshot

> Source of truth for AI when writing migrations. Update this file when you run a new migration.
> Next migration number: **005**
> Last updated: 2026-06-04

## Rules for writing migrations

- File: `infrastructure/postgres/migrations/{N}_{description}.sql`
- Always check this file before `CREATE TABLE` — table may already exist → use `ALTER TABLE` instead
- Always include rollback comment at the bottom: `-- ROLLBACK: DROP TABLE ...`
- Foreign keys: reference the exact column listed here

---

## Tables by Service

### user-service

| Table           | Key columns                                                                                                                                                  | Indexes                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `users`         | `id uuid PK`, `email varchar UNIQUE`, `phone varchar`, `username varchar UNIQUE`, `password_hash`, `role enum`, `is_active bool`, `created_at`, `updated_at` | email, username, phone           |
| `user_profiles` | `id uuid PK`, `user_id uuid FK→users`, `display_name`, `avatar_url`, `bio`, `follower_count int`, `following_count int`                                      | user_id                          |
| `user_follows`  | `id uuid PK`, `follower_id uuid FK→users`, `followee_id uuid FK→users`, `created_at`                                                                         | UNIQUE(follower_id, followee_id) |

### order-service

| Table            | Key columns                                                                                                                                                                                                                                          | Indexes                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `orders`         | `id uuid PK`, `user_id uuid`, `seller_id uuid`, `status enum(pending/confirmed/processing/shipped/delivered/cancelled/refunded)`, `total_amount bigint`, `currency varchar`, `shipping_address jsonb`, `voucher_id uuid`, `created_at`, `updated_at` | (user_id, created_at), status                     |
| `order_items`    | `id uuid PK`, `order_id uuid FK→orders`, `product_id uuid`, `variant_id uuid`, `quantity int`, `unit_price bigint`, `subtotal bigint`                                                                                                                | order_id, product_id                              |
| `vouchers`       | `id uuid PK`, `code varchar UNIQUE`, `seller_id uuid`, `type enum`, `discount_value bigint`, `min_order bigint`, `max_uses int`, `used_count int`, `starts_at timestamp`, `expires_at timestamp`, `status enum`                                      | (status, starts_at, expires_at)                   |
| `voucher_usages` | `id uuid PK`, `voucher_id uuid FK→vouchers`, `user_id uuid`, `order_id uuid FK→orders`, `created_at`                                                                                                                                                 | UNIQUE(voucher_id, user_id)                       |
| `commissions`    | `id uuid PK`, `order_id uuid FK→orders`, `seller_id uuid`, `amount bigint`, `rate decimal`, `status enum`, `created_at`, `updated_at`                                                                                                                | (seller_id, status)                               |
| `disputes`       | `id uuid PK`, `order_id uuid FK→orders`, `buyer_id uuid`, `seller_id uuid`, `reason text`, `status enum`, `resolution text`, `created_at`, `updated_at`                                                                                              | order_id, (buyer_id, status), (seller_id, status) |
| `outbox_events`  | `id uuid PK`, `topic varchar`, `aggregate_type varchar`, `aggregate_id uuid`, `partition_key varchar`, `payload jsonb`, `published bool DEFAULT false`, `created_at`                                                                                 | (published, created_at)                           |

### payment-service

| Table      | Key columns                                                                                                                                                                               | Indexes                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `payments` | `id uuid PK`, `order_id uuid`, `user_id uuid`, `provider enum(stripe/vnpay/momo)`, `provider_ref varchar`, `amount bigint`, `currency varchar`, `status enum`, `created_at`, `updated_at` | order_id, provider_ref |
| `refunds`  | `id uuid PK`, `payment_id uuid FK→payments`, `amount bigint`, `reason text`, `status enum`, `created_at`                                                                                  | payment_id             |

### inventory-service

| Table                | Key columns                                                                                                                                                                                  | Indexes                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `product_stock`      | `id uuid PK`, `product_id uuid UNIQUE`, `variant_id uuid`, `quantity int`, `reserved int`, `warehouse_id uuid`, `updated_at`                                                                 | product_id, variant_id         |
| `stock_reservations` | `id uuid PK`, `product_id uuid`, `order_id uuid`, `quantity int`, `status enum`, `expires_at timestamp`, `created_at`                                                                        | (product_id, status), order_id |
| `stock_waitlist`     | `id uuid PK`, `product_id uuid`, `user_id uuid`, `quantity int`, `created_at`                                                                                                                | UNIQUE(product_id, user_id)    |
| `flash_sales`        | `id uuid PK`, `product_id uuid`, `seller_id uuid`, `original_price bigint`, `sale_price bigint`, `quantity int`, `sold_count int`, `starts_at timestamp`, `ends_at timestamp`, `status enum` | (status, starts_at, ends_at)   |

### review-service

| Table             | Key columns                                                                                                                                                                                                                                                                                                                                            | Indexes                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `reviews`         | `id uuid PK`, `product_id uuid`, `user_id uuid`, `seller_id uuid`, `order_id uuid`, `rating smallint(1-5)`, `title varchar`, `content text`, `status enum(pending/approved/rejected/flagged)`, `verified_purchase bool`, `helpful_count int`, `moderation_score decimal`, `seller_reply text`, `seller_reply_at timestamp`, `created_at`, `updated_at` | (product_id, status), (user_id), UNIQUE(product_id, user_id, order_id) |
| `review_helpfuls` | `id uuid PK`, `review_id uuid FK→reviews`, `user_id uuid`, `created_at`                                                                                                                                                                                                                                                                                | UNIQUE(review_id, user_id)                                             |

### notification-service

| Table           | Key columns                                                                                                                                          | Indexes                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `notifications` | `id uuid PK`, `user_id uuid`, `type varchar`, `title varchar`, `body text`, `data jsonb`, `channel enum`, `is_read bool DEFAULT false`, `created_at` | (user_id, is_read), (user_id, created_at) |

### ads-service

| Table            | Key columns                                                                                                                                                                             | Indexes                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `ad_campaigns`   | `id uuid PK`, `seller_id uuid`, `name varchar`, `type enum(cpc/cpm/cpa)`, `budget bigint`, `spent bigint`, `status enum`, `starts_at timestamp`, `ends_at timestamp`, `targeting jsonb` | (seller_id, status)                |
| `ad_impressions` | `id uuid PK`, `campaign_id uuid FK→ad_campaigns`, `user_id uuid`, `product_id uuid`, `type enum(impression/click/conversion)`, `bid_price bigint`, `created_at`                         | (campaign_id, created_at), user_id |

### subscription-service

| Table                  | Key columns                                                                                                                                                                             | Indexes                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `subscription_plans`   | `id uuid PK`, `name varchar`, `tier enum(FREE/BASIC/PRO/ENTERPRISE)`, `price bigint`, `billing_cycle enum`, `features jsonb`                                                            | tier                                    |
| `seller_subscriptions` | `id uuid PK`, `seller_id uuid`, `plan_id uuid FK→subscription_plans`, `status enum`, `current_period_start timestamp`, `current_period_end timestamp`, `stripe_subscription_id varchar` | seller_id, (status, current_period_end) |

### chat-service

| Table           | Key columns                                                                                                                                              | Indexes                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `conversations` | `id uuid PK`, `type enum(direct/support/ai_bot)`, `participant_ids uuid[]`, `last_message_at timestamp`, `created_at`                                    | participant_ids (GIN)         |
| `chat_messages` | `id uuid PK`, `conversation_id uuid FK→conversations`, `sender_id uuid`, `content text`, `type enum(text/image/order_ref)`, `is_read bool`, `created_at` | (conversation_id, created_at) |

---

## Cross-service Kafka Events (reference for migrations)

```
order.created / order.confirmed / order.cancelled
payment.captured / payment.failed
inventory.reserved / inventory.released / inventory.insufficient
review.published / review.rejected
user.followed
notification.dispatch
```
