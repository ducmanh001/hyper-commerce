# BullMQ Queue & Job Catalog

> Auto-generated from `libs/queue/src/constants/queue.constants.ts`
> Last updated: 2026-06-04 — do not edit manually, changes will be overwritten.
> Source of truth: `queue.constants.ts`

---

## Queue Names — `QUEUE_NAMES`

| Constant                  | Queue string              | Priority     | Domain               |
| ------------------------- | ------------------------- | ------------ | -------------------- |
| `ORDER_PROCESSING`        | `order:processing`        | CRITICAL     | order-service        |
| `ORDER_SAGA_COMPENSATION` | `order:saga:compensation` | CRITICAL     | order-service        |
| `PAYMENT_CHARGE`          | `payment:charge`          | CRITICAL     | payment-service      |
| `PAYMENT_REFUND`          | `payment:refund`          | CRITICAL     | payment-service      |
| `PAYMENT_WEBHOOK`         | `payment:webhook`         | CRITICAL     | payment-service      |
| `NOTIFICATION_EMAIL`      | `notification:email`      | NON_CRITICAL | notification-service |
| `NOTIFICATION_SMS`        | `notification:sms`        | NON_CRITICAL | notification-service |
| `NOTIFICATION_PUSH`       | `notification:push`       | NON_CRITICAL | notification-service |
| `NOTIFICATION_IN_APP`     | `notification:in-app`     | NON_CRITICAL | notification-service |
| `FEED_FANOUT`             | `feed:fanout`             | BEST_EFFORT  | feed-service         |
| `FEED_RERANK`             | `feed:rerank`             | BEST_EFFORT  | feed-service         |
| `SEARCH_INDEX`            | `search:index`            | BEST_EFFORT  | search-service       |
| `SEARCH_BULK_INDEX`       | `search:bulk-index`       | BEST_EFFORT  | search-service       |
| `AI_RECOMMENDATION`       | `ai:recommendation`       | NON_CRITICAL | ai-service           |
| `AI_FRAUD_CHECK`          | `ai:fraud-check`          | NON_CRITICAL | ai-service           |
| `AI_EMBEDDING_GENERATE`   | `ai:embedding-generate`   | NON_CRITICAL | ai-service           |
| `ANALYTICS_INGEST`        | `analytics:ingest`        | BEST_EFFORT  | analytics-service    |
| `REVIEW_PROCESSING`       | `review:processing`       | NON_CRITICAL | review-service       |
| `MEDIA_RESIZE`            | `media:resize`            | BEST_EFFORT  | —                    |
| `MEDIA_THUMBNAIL`         | `media:thumbnail`         | BEST_EFFORT  | —                    |
| `STOCK_RECONCILE`         | `stock:reconcile`         | CRITICAL     | inventory-service    |
| `STOCK_SYNC`              | `stock:sync`              | BEST_EFFORT  | inventory-service    |

---

## Job Names — `JOB_NAMES`

| Constant                       | Job string                     | Queue                   | Processor service    |
| ------------------------------ | ------------------------------ | ----------------------- | -------------------- |
| `CREATE_ORDER`                 | `create-order`                 | ORDER_PROCESSING        | order-service        |
| `CANCEL_ORDER`                 | `cancel-order`                 | ORDER_PROCESSING        | order-service        |
| `COMPENSATE_STOCK`             | `compensate-stock`             | ORDER_SAGA_COMPENSATION | order-service        |
| `COMPENSATE_PAYMENT`           | `compensate-payment`           | ORDER_SAGA_COMPENSATION | order-service        |
| `CHARGE_STRIPE`                | `charge-stripe`                | PAYMENT_CHARGE          | payment-service      |
| `CHARGE_VNPAY`                 | `charge-vnpay`                 | PAYMENT_CHARGE          | payment-service      |
| `CHARGE_MOMO`                  | `charge-momo`                  | PAYMENT_CHARGE          | payment-service      |
| `PROCESS_REFUND`               | `process-refund`               | PAYMENT_REFUND          | payment-service      |
| `HANDLE_WEBHOOK`               | `handle-webhook`               | PAYMENT_WEBHOOK         | payment-service      |
| `SEND_ORDER_CONFIRMATION`      | `send-order-confirmation`      | NOTIFICATION_EMAIL      | notification-service |
| `SEND_PAYMENT_RECEIPT`         | `send-payment-receipt`         | NOTIFICATION_EMAIL      | notification-service |
| `SEND_SHIP_UPDATE`             | `send-ship-update`             | NOTIFICATION_PUSH       | notification-service |
| `SEND_PROMO`                   | `send-promo`                   | NOTIFICATION_PUSH       | notification-service |
| `SEND_OTP`                     | `send-otp`                     | NOTIFICATION_SMS        | notification-service |
| `FANOUT_POST`                  | `fanout-post`                  | FEED_FANOUT             | feed-service         |
| `CELEBRITY_FANOUT`             | `celebrity-fanout`             | FEED_FANOUT             | feed-service         |
| `FEED_CLEANUP`                 | `feed-cleanup`                 | FEED_RERANK             | feed-service         |
| `INDEX_PRODUCT`                | `index-product`                | SEARCH_INDEX            | search-service       |
| `BULK_REINDEX`                 | `bulk-reindex`                 | SEARCH_BULK_INDEX       | search-service       |
| `DELETE_FROM_INDEX`            | `delete-from-index`            | SEARCH_INDEX            | search-service       |
| `COMPUTE_RECOMMENDATIONS`      | `compute-recommendations`      | AI_RECOMMENDATION       | ai-service           |
| `SCORE_FRAUD`                  | `score-fraud`                  | AI_FRAUD_CHECK          | ai-service           |
| `GENERATE_EMBEDDINGS`          | `generate-embeddings`          | AI_EMBEDDING_GENERATE   | ai-service           |
| `BATCH_RERANK`                 | `batch-rerank`                 | AI_RECOMMENDATION       | ai-service           |
| `RECONCILE_STOCK`              | `reconcile-stock`              | STOCK_RECONCILE         | inventory-service    |
| `RELEASE_EXPIRED_RESERVATIONS` | `release-expired-reservations` | STOCK_RECONCILE         | inventory-service    |
| `PROCESS_REVIEW`               | `process-review`               | REVIEW_PROCESSING       | review-service       |
| `UPDATE_PRODUCT_RATING`        | `update-product-rating`        | REVIEW_PROCESSING       | review-service       |
| `NOTIFY_SELLER_REVIEW`         | `notify-seller-review`         | NOTIFICATION_IN_APP     | notification-service |

---

## Concurrency Settings (descending)

| Queue                | Max concurrent workers |
| -------------------- | ---------------------- |
| `notification:push`  | 500                    |
| `analytics:ingest`   | 500                    |
| `notification:email` | 200                    |
| `search:index`       | 200                    |
| `payment:charge`     | 100                    |
| `notification:sms`   | 100                    |
| `order:processing`   | 50                     |
| `feed:fanout`        | 50                     |
| `ai:fraud-check`     | 50                     |
| `payment:refund`     | 20                     |
| `ai:recommendation`  | 20                     |
| `stock:reconcile`    | 10                     |

---

## Job Options Profiles

| Profile        | Retries | Backoff        | Use for                   |
| -------------- | ------- | -------------- | ------------------------- |
| `CRITICAL`     | 3       | exponential 1s | order, payment, stock     |
| `NON_CRITICAL` | 5       | exponential 2s | notifications, AI, review |
| `BEST_EFFORT`  | 2       | fixed 5s       | feed, search index, media |
| `SCHEDULED`    | 1       | none           | cron / delayed jobs       |
