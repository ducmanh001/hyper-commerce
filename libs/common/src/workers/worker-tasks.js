/**
 * Worker task implementations — runs in worker_threads context.
 *
 * This file is loaded by worker_threads as a separate script.
 * It must NOT import NestJS/DI modules — plain Node.js only.
 *
 * Each task type receives a typed payload and posts a result back.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { parentPort } = require('worker_threads');
const zlib = require('zlib');
const crypto = require('crypto');

if (!parentPort) {
  throw new Error('worker-tasks.js must be loaded as a Worker Thread');
}

parentPort.on('message', async (task) => {
  try {
    let data;

    switch (task.type) {
      case 'REPORT_CSV':
        data = await handleReportCsv(task.payload);
        break;

      case 'FRAUD_SCORE':
        data = handleFraudScore(task.payload);
        break;

      case 'HASH_PASSWORD':
        data = await handleHashPassword(task.payload);
        break;

      case 'RANK_FEED':
        data = handleRankFeed(task.payload);
        break;

      case 'COMPRESS_BATCH':
        data = await handleCompressBatch(task.payload);
        break;

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }

    parentPort.postMessage({ data });
  } catch (err) {
    parentPort.postMessage({ error: err.message });
  }
});

// ── Task Handlers ────────────────────────────────────────────────────────────

/**
 * REPORT_CSV: Convert array of objects → CSV string.
 * CPU cost: string concatenation over potentially 100K+ rows.
 */
async function handleReportCsv(payload) {
  const { rows, columns } = payload;
  if (!rows?.length) return '';

  const header = columns.join(',');
  const body   = rows.map((row) =>
    columns.map((col) => {
      const val = row[col] ?? '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
    }).join(','),
  ).join('\n');

  return `${header}\n${body}`;
}

/**
 * FRAUD_SCORE: Lightweight logistic regression for real-time fraud scoring.
 * Features: velocity (orders in last hour), amount, country mismatch, etc.
 * A real implementation would load a serialised sklearn/ONNX model.
 */
function handleFraudScore(payload) {
  const {
    orderAmountVnd    = 0,
    ordersLast1h      = 0,
    ordersLast24h     = 0,
    differentIps1h    = 0,
    countryMismatch   = false,
    newAccount        = false,
    usedVoucherBefore = false,
  } = payload;

  // Simple heuristic model (replace with ONNX in production)
  let score = 0;
  if (orderAmountVnd > 50_000_000)     score += 25; // > 50M VND
  if (ordersLast1h  > 5)              score += 30;
  if (ordersLast24h > 20)             score += 20;
  if (differentIps1h > 2)             score += 15;
  if (countryMismatch)                score += 20;
  if (newAccount && orderAmountVnd > 5_000_000) score += 10;
  if (!usedVoucherBefore && orderAmountVnd > 2_000_000) score += 5;

  return {
    score:   Math.min(score, 100),
    risk:    score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW',
    signals: {
      highAmount:      orderAmountVnd > 50_000_000,
      velocityHigh:    ordersLast1h > 5,
      multipleIps:     differentIps1h > 2,
      countryMismatch,
    },
  };
}

/**
 * HASH_PASSWORD: bcrypt bulk import.
 * Uses Node.js crypto PBKDF2 as a safe fallback without native binding.
 */
async function handleHashPassword(payload) {
  const { password, rounds = 12 } = payload;
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, Math.pow(2, rounds), 64, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(`pbkdf2$${rounds}$${salt}$${key.toString('hex')}`);
    });
  });
}

/**
 * RANK_FEED: Score a batch of feed items using dot-product similarity.
 * user_embedding × item_embedding + recency_boost + seller_boost
 */
function handleRankFeed(payload) {
  const { userEmbedding, items } = payload;

  return items
    .map((item) => {
      const dot    = dotProduct(userEmbedding, item.embedding);
      const recency = Math.exp(-((Date.now() - item.createdAt) / 86400000)); // decay per day
      const score  = dot * 0.7 + recency * 0.3;
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score);
}

function dotProduct(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

/**
 * COMPRESS_BATCH: gzip JSON records before S3/GCS upload.
 */
async function handleCompressBatch(payload) {
  const { records } = payload;
  const json = JSON.stringify(records);
  return new Promise((resolve, reject) => {
    zlib.gzip(Buffer.from(json), (err, buf) => {
      if (err) reject(err);
      else resolve({ compressed: buf.toString('base64'), originalBytes: json.length, compressedBytes: buf.length });
    });
  });
}
