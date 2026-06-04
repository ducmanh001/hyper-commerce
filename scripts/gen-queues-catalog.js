#!/usr/bin/env node
/**
 * gen-queues-catalog.js
 * Auto-generates libs/queue/QUEUES.md from queue.constants.ts
 * Triggered by lint-staged when queue.constants.ts changes.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../libs/queue/src/constants/queue.constants.ts');
const OUT = path.resolve(__dirname, '../libs/queue/QUEUES.md');

const src = fs.readFileSync(SRC, 'utf8');

/** Extract key: 'value' pairs from a named const object block */
function parseConstObject(src, name) {
  const re = new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\}\\s*as const`);
  const match = src.match(re);
  if (!match) return {};
  const body = match[1];
  const result = {};
  const lineRe = /(\w+):\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

/** Extract key: number pairs from QUEUE_CONCURRENCY */
function parseConcurrency(src) {
  const re = /export const QUEUE_CONCURRENCY[^=]*=\s*\{([\s\S]*?)\}\s*as const/;
  const match = src.match(re);
  if (!match) return {};
  const body = match[1];
  const result = {};
  // Match: QUEUE_NAMES.KEY]: number
  const lineRe = /QUEUE_NAMES\.(\w+)\]:\s*(\d+)/g;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    result[m[1]] = parseInt(m[2], 10);
  }
  return result;
}

/** Guess priority profile from queue name pattern */
function getPriority(key) {
  if (/ORDER|PAYMENT|STOCK_RECONCILE/.test(key)) return 'CRITICAL';
  if (/NOTIFICATION|AI_|REVIEW/.test(key)) return 'NON_CRITICAL';
  return 'BEST_EFFORT';
}

/** Guess owner service from queue name */
function getOwner(key) {
  if (/ORDER/.test(key)) return 'order-service';
  if (/PAYMENT/.test(key)) return 'payment-service';
  if (/NOTIFICATION/.test(key)) return 'notification-service';
  if (/FEED/.test(key)) return 'feed-service';
  if (/SEARCH/.test(key)) return 'search-service';
  if (/AI_/.test(key)) return 'ai-service';
  if (/ANALYTICS/.test(key)) return 'analytics-service';
  if (/REVIEW/.test(key)) return 'review-service';
  if (/STOCK|INVENTORY/.test(key)) return 'inventory-service';
  if (/MEDIA/.test(key)) return '—';
  return '—';
}

/** Guess which queue a job belongs to */
function guessQueue(jobKey, queueNames) {
  const map = {
    CREATE_ORDER: 'ORDER_PROCESSING', CANCEL_ORDER: 'ORDER_PROCESSING',
    COMPENSATE_STOCK: 'ORDER_SAGA_COMPENSATION', COMPENSATE_PAYMENT: 'ORDER_SAGA_COMPENSATION',
    CHARGE_STRIPE: 'PAYMENT_CHARGE', CHARGE_VNPAY: 'PAYMENT_CHARGE', CHARGE_MOMO: 'PAYMENT_CHARGE',
    PROCESS_REFUND: 'PAYMENT_REFUND', HANDLE_WEBHOOK: 'PAYMENT_WEBHOOK',
    SEND_ORDER_CONFIRMATION: 'NOTIFICATION_EMAIL', SEND_PAYMENT_RECEIPT: 'NOTIFICATION_EMAIL',
    SEND_SHIP_UPDATE: 'NOTIFICATION_PUSH', SEND_PROMO: 'NOTIFICATION_PUSH',
    SEND_OTP: 'NOTIFICATION_SMS',
    FANOUT_POST: 'FEED_FANOUT', CELEBRITY_FANOUT: 'FEED_FANOUT', FEED_CLEANUP: 'FEED_RERANK',
    INDEX_PRODUCT: 'SEARCH_INDEX', BULK_REINDEX: 'SEARCH_BULK_INDEX',
    DELETE_FROM_INDEX: 'SEARCH_INDEX',
    COMPUTE_RECOMMENDATIONS: 'AI_RECOMMENDATION', SCORE_FRAUD: 'AI_FRAUD_CHECK',
    GENERATE_EMBEDDINGS: 'AI_EMBEDDING_GENERATE', BATCH_RERANK: 'AI_RECOMMENDATION',
    RECONCILE_STOCK: 'STOCK_RECONCILE', RELEASE_EXPIRED_RESERVATIONS: 'STOCK_RECONCILE',
    PROCESS_REVIEW: 'REVIEW_PROCESSING', UPDATE_PRODUCT_RATING: 'REVIEW_PROCESSING',
    NOTIFY_SELLER_REVIEW: 'NOTIFICATION_IN_APP',
  };
  return map[jobKey] || '—';
}

const queueNames = parseConstObject(src, 'QUEUE_NAMES');
const jobNames = parseConstObject(src, 'JOB_NAMES');
const concurrency = parseConcurrency(src);

// Sort concurrency descending
const concurrencySorted = Object.entries(concurrency)
  .map(([k, v]) => ({ key: k, val: v }))
  .sort((a, b) => b.val - a.val);

const now = new Date().toISOString().slice(0, 10);

let md = `# BullMQ Queue & Job Catalog

> Auto-generated from \`libs/queue/src/constants/queue.constants.ts\`
> Last updated: ${now} — do not edit manually, changes will be overwritten.
> Source of truth: \`queue.constants.ts\`

---

## Queue Names — \`QUEUE_NAMES\`

| Constant | Queue string | Priority | Domain |
|---|---|---|---|
`;

for (const [key, val] of Object.entries(queueNames)) {
  md += `| \`${key}\` | \`${val}\` | ${getPriority(key)} | ${getOwner(key)} |\n`;
}

md += `
---

## Job Names — \`JOB_NAMES\`

| Constant | Job string | Queue | Processor service |
|---|---|---|---|
`;

for (const [key, val] of Object.entries(jobNames)) {
  const queue = guessQueue(key, queueNames);
  md += `| \`${key}\` | \`${val}\` | ${queue} | ${getOwner(queue)} |\n`;
}

md += `
---

## Concurrency Settings (descending)

| Queue | Max concurrent workers |
|---|---|
`;

for (const { key, val } of concurrencySorted) {
  const queueVal = queueNames[key] || key;
  md += `| \`${queueVal}\` | ${val} |\n`;
}

md += `
---

## Job Options Profiles

| Profile | Retries | Backoff | Use for |
|---|---|---|---|
| \`CRITICAL\` | 3 | exponential 1s | order, payment, stock |
| \`NON_CRITICAL\` | 5 | exponential 2s | notifications, AI, review |
| \`BEST_EFFORT\` | 2 | fixed 5s | feed, search index, media |
| \`SCHEDULED\` | 1 | none | cron / delayed jobs |
`;

fs.writeFileSync(OUT, md, 'utf8');
console.log(`✅ QUEUES.md regenerated (${Object.keys(queueNames).length} queues, ${Object.keys(jobNames).length} jobs)`);
