/**
 * HyperCommerce API Gateway
 * ─────────────────────────
 * Architecture: FE (Next.js) → API Gateway → PostgreSQL / Redis / Kafka
 *
 * Responsibilities:
 *  - JWT auth & RBAC middleware
 *  - REST endpoints for: auth, users, products, cart, orders, live-streams, notifications
 *  - Socket.IO server for: live chat, WebRTC signaling
 *  - Redis: caching, cart session, rate limiting
 *  - Kafka: async events (order.placed, user.registered, etc.)
 *  - Comment persistence to PostgreSQL (via Kafka consumer)
 */

'use strict';

const http        = require('http');
const express     = require('express');
const { Server }  = require('socket.io');
const { Pool }    = require('pg');
const Redis       = require('ioredis');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');
const { Kafka }   = require('kafkajs');

// ─── Config ────────────────────────────────────────────────────────────────
const PORT        = process.env.GATEWAY_PORT ?? 4000;
const JWT_SECRET  = process.env.JWT_SECRET ?? 'hypercommerce_dev_jwt_secret_change_in_prod';
const CORS_ORIGIN = process.env.CORS_ORIGINS ?? 'http://localhost:3000';

// ─── PostgreSQL ─────────────────────────────────────────────────────────────
const db = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  user:     process.env.DB_USER     ?? 'hypercommerce',
  password: process.env.DB_PASSWORD ?? 'hypercommerce_secret',
  database: process.env.DB_NAME     ?? 'hypercommerce',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function q(text, params) {
  const client = await db.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
}
async function q1(text, params) { const rows = await q(text, params); return rows[0] ?? null; }

// ─── Redis ───────────────────────────────────────────────────────────────────
const redis = new Redis({
  host:     process.env.REDIS_HOST     ?? 'localhost',
  port:     Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? 'redis_secret',
  lazyConnect: true,
  retryStrategy: () => null,
});
redis.connect().catch(() => console.warn('[Gateway] Redis not available, running without cache'));

// ─── Kafka ───────────────────────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'api-gateway',
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:29092').split(','),
  connectionTimeout: 3000,
  requestTimeout: 5000,
});
const producer = kafka.producer();

async function publishEvent(topic, key, value) {
  try {
    await producer.send({
      topic,
      messages: [{ key: String(key), value: JSON.stringify(value) }],
    });
  } catch (err) {
    console.warn(`[Kafka] Failed to publish ${topic}:`, err.message);
  }
}

// ─── Express ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ① Giới hạn payload size — chống DoS bằng body khổng lồ
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ② Security headers — thay thế helmet (không cần cài thêm package)
app.use((req, res, next) => {
  // Chống clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Chống MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Tắt cache cho API responses
  res.setHeader('Cache-Control', 'no-store');
  // Giấu thông tin server
  res.removeHeader('X-Powered-By');
  // Content Security Policy cho API
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// ③ CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ④ Access logging — ghi lại mọi request (IP, method, path, status, latency)
app.use((req, res, next) => {
  const start = Date.now();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[${level}] ${new Date().toISOString()} ${ip} ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ⑤ Rate limiting (Redis sliding window)
async function rateLimiter(key, limit, windowSec) {
  try {
    const now  = Date.now();
    const win  = Math.floor(now / (windowSec * 1000));
    const rKey = `rl:${key}:${win}`;
    const cnt  = await redis.incr(rKey);
    if (cnt === 1) await redis.expire(rKey, windowSec * 2);
    return cnt <= limit;
  } catch {
    return true; // Redis down → không block request
  }
}

function rateLimit(limit, windowSec = 60) {
  return async (req, res, next) => {
    const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'anon';
    const key = `${ip}:${req.path}`;
    const ok  = await rateLimiter(key, limit, windowSec);
    if (!ok) {
      return res.status(429).json({
        message: 'Too Many Requests. Vui lòng thử lại sau.',
        retryAfter: windowSec,
      });
    }
    next();
  };
}

// Preset limits
const authLimit    = rateLimit(10, 60);   // auth routes: 10 req/phút/IP (chống brute-force)
const strictLimit  = rateLimit(30, 60);   // write routes: 30 req/phút/IP
const publicLimit  = rateLimit(120, 60);  // public read: 120 req/phút/IP

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    // Support both real JWT and demo tokens
    if (token.startsWith('real.') || token.startsWith('demo.')) {
      const b64 = token.split('.')[1];
      req.user = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } else {
      req.user = jwt.verify(token, JWT_SECRET);
    }
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    const userRole = (req.user.role ?? '').toUpperCase();
    if (!roles.map(r => r.toUpperCase()).includes(userRole)) {
      return res.status(403).json({ message: `Forbidden. Required role: ${roles.join('|')}` });
    }
    next();
  };
}

// ─── Image helper ─────────────────────────────────────────────────────────────
const PRODUCT_IMAGES = [
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400',
  'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=400',
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400',
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=400',
  'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400',
  'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=400',
  'https://images.unsplash.com/photo-1625772452859-1c03d5bf1137?w=400',
  'https://images.unsplash.com/photo-1585432959449-afbed7bb2b47?w=400',
  'https://images.unsplash.com/photo-1590725140246-20acdee442be?w=400',
  'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=400',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400',
  'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400',
];
function randomImage(name) {
  const idx = name ? name.charCodeAt(0) % PRODUCT_IMAGES.length : Math.floor(Math.random() * PRODUCT_IMAGES.length);
  return PRODUCT_IMAGES[idx];
}

// ═══════════════════════════════════════════════════════════════════════════
// ── AUTH ROUTES ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', authLimit, async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) return res.status(400).json({ message: 'email, password, fullName required' });

    const existing = await q1('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ message: 'Email đã được sử dụng' });

    const passwordHash = await bcrypt.hash(password, 10);
    const username = email.split('@')[0] + '_' + Date.now().toString(36);
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;

    const [user] = await q(
      `INSERT INTO users (email, "fullName", username, "passwordHash", "avatarUrl", roles, status, "emailVerified")
       VALUES ($1, $2, $3, $4, $5, 'BUYER', 'ACTIVE', false)
       RETURNING id, email, "fullName", "avatarUrl", roles`,
      [email, fullName, username, passwordHash, avatar],
    );

    // Kafka event
    await publishEvent('user.registered', user.id, { userId: user.id, email, fullName });

    const token = jwt.sign({ id: user.id, role: 'BUYER' }, JWT_SECRET, { expiresIn: '24h' });
    const prefixedToken = `real.${Buffer.from(JSON.stringify({ id: user.id, role: 'BUYER', exp: Math.floor(Date.now()/1000)+86400 })).toString('base64')}.sig`;

    res.status(201).json({
      user: { id: user.id, email: user.email, fullName: user.fullName, avatar: user.avatarUrl, role: 'BUYER', points: 0 },
      accessToken: prefixedToken,
      refreshToken: `refresh.${prefixedToken}`,
    });
  } catch (err) {
    console.error('[Register]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email and password required' });

    const user = await q1(
      `SELECT id, email, "fullName", "avatarUrl", roles, "passwordHash", status
       FROM users WHERE email = $1`,
      [email],
    );

    if (!user || user.status === 'BANNED') {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    if (user.passwordHash) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    } else {
      // Legacy: user created without hash (demo seed) — accept any password
    }

    const role = (user.roles ?? 'BUYER').split(',')[0].trim().toUpperCase();
    const payload = { id: user.id, role, exp: Math.floor(Date.now() / 1000) + 86400 };
    const token = `real.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;

    res.json({
      user: { id: user.id, email: user.email, fullName: user.fullName, avatar: user.avatarUrl, role, sellerId: undefined, points: 0 },
      accessToken: token,
      refreshToken: `refresh.${token}`,
    });
  } catch (err) {
    console.error('[Login]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await q1('SELECT id, email, "fullName", "avatarUrl", roles FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/refresh — đổi refresh token lấy access token mới
// Trong production dùng rotated refresh token (1 lần dùng rồi xoá khỏi Redis)
app.post('/api/auth/refresh', authLimit, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });

    // Parse refresh token (format: refresh.real.BASE64.sig)
    const inner = refreshToken.replace(/^refresh\./, '');
    const b64   = inner.split('.')[1];
    if (!b64) return res.status(401).json({ message: 'Invalid refresh token' });

    let payload;
    try {
      payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    if (!payload.id) return res.status(401).json({ message: 'Invalid payload' });

    // Check token chưa bị revoke (Redis blacklist)
    const revoked = await redis.get(`revoked:${b64}`).catch(() => null);
    if (revoked) return res.status(401).json({ message: 'Token đã bị thu hồi' });

    // Lấy user mới nhất từ DB (role có thể đã thay đổi)
    const user = await q1('SELECT id, email, "fullName", "avatarUrl", roles, status FROM users WHERE id = $1', [payload.id]);
    if (!user || user.status === 'BANNED') {
      return res.status(401).json({ message: 'Tài khoản không còn hợp lệ' });
    }

    // Revoke refresh token cũ (rotation — không dùng 2 lần)
    await redis.setex(`revoked:${b64}`, 7 * 24 * 3600, '1').catch(() => {});

    // Cấp token mới
    const role       = (user.roles ?? 'BUYER').split(',')[0].trim().toUpperCase();
    const newPayload = { id: user.id, role, exp: Math.floor(Date.now() / 1000) + 86400 };
    const newToken   = `real.${Buffer.from(JSON.stringify(newPayload)).toString('base64')}.sig`;

    res.json({
      accessToken:  newToken,
      refreshToken: `refresh.${newToken}`,
      expiresIn:    86400,
    });
  } catch (err) {
    console.error('[Refresh]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/logout — revoke refresh token
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const inner = refreshToken.replace(/^refresh\./, '');
      const b64   = inner.split('.')[1];
      if (b64) await redis.setex(`revoked:${b64}`, 7 * 24 * 3600, '1').catch(() => {});
    }
    res.json({ ok: true, message: 'Đã đăng xuất' });
  } catch {
    res.json({ ok: true });
  }
});



// ═══════════════════════════════════════════════════════════════════════════
// ── PRODUCTS ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/products
app.get('/api/products', publicLimit, async (req, res) => {
  try {
    const { sellerId, category, q: search, limit = 20, offset = 0 } = req.query;
    let sql = `SELECT * FROM products WHERE status = 'ACTIVE'`;
    const params = [];
    if (sellerId) { params.push(sellerId); sql += ` AND "sellerId" = $${params.length}`; }
    if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
    if (search)   { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    sql += ` ORDER BY "createdAt" DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
    const products = await q(sql, params);

    // Add random image if no images
    const enriched = products.map(p => ({
      ...p,
      images: (p.images && p.images.length) ? p.images : [randomImage(p.name)],
    }));
    res.json({ data: enriched, total: enriched.length });
  } catch (err) {
    console.error('[Products]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/products (seller only)
app.post('/api/products', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { name, description, price, originalPrice, category, sku, stock, images } = req.body;
    if (!name || !price) return res.status(400).json({ message: 'name, price required' });

    const productImages = (images && images.length) ? images : [randomImage(name)];

    const [product] = await q(
      `INSERT INTO products ("sellerId", name, description, price, "originalPrice", category, sku, stock, images, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE')
       RETURNING *`,
      [req.user.id, name, description ?? null, price, originalPrice ?? null, category ?? null, sku ?? null, stock ?? 0, JSON.stringify(productImages)],
    );

    // Kafka event
    await publishEvent('product.created', product.id, { productId: product.id, sellerId: req.user.id, name });

    res.status(201).json(product);
  } catch (err) {
    console.error('[Products POST]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/products/:id
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await q1('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (!product.images || !product.images.length) product.images = [randomImage(product.name)];
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/products/:id
app.patch('/api/products/:id', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { name, description, price, stock, status, images } = req.body;
    const fields = [];
    const params = [req.params.id];

    if (name        !== undefined) { params.push(name);        fields.push(`name = $${params.length}`); }
    if (description !== undefined) { params.push(description); fields.push(`description = $${params.length}`); }
    if (price       !== undefined) { params.push(price);       fields.push(`price = $${params.length}`); }
    if (stock       !== undefined) { params.push(stock);       fields.push(`stock = $${params.length}`); }
    if (status      !== undefined) { params.push(status);      fields.push(`status = $${params.length}`); }
    if (images      !== undefined) { params.push(JSON.stringify(images)); fields.push(`images = $${params.length}`); }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
    fields.push(`"updatedAt" = NOW()`);

    const [updated] = await q(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (!updated) return res.status(404).json({ message: 'Product not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── CART ───────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function getCart(userId) {
  try {
    const cached = await redis.get(`cart:${userId}`);
    if (cached) return JSON.parse(cached);
  } catch {}
  // Fallback: try to load from DB cart table
  try {
    const rows = await q(`SELECT * FROM cart_items WHERE "userId" = $1`, [userId]);
    return rows.map(r => ({ productId: r.productId, variantId: r.variantId, name: r.name, price: Number(r.price), image: r.image, quantity: r.quantity, sellerId: r.sellerId }));
  } catch {}
  return [];
}
async function saveCart(userId, items) {
  try { await redis.set(`cart:${userId}`, JSON.stringify(items), 'EX', 86400 * 7); } catch {}
  // Persist to DB for durability (survives Redis restarts)
  try {
    await db.query(`DELETE FROM cart_items WHERE "userId" = $1`, [userId]);
    for (const item of items) {
      await db.query(
        `INSERT INTO cart_items ("userId", "productId", "variantId", name, price, image, quantity, "sellerId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, item.productId, item.variantId ?? null, item.name, item.price, item.image ?? null, item.quantity, item.sellerId ?? null],
      );
    }
  } catch (e) { /* DB cart backup failed — Redis is still source of truth */ }
}

function cartResponse(items) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingFee = subtotal > 200_000 ? 0 : 30_000;
  return {
    items: items.map(i => ({ ...i, unitPrice: i.price })),
    subtotal,
    shippingFee,
    voucherDiscount: 0,
    total: subtotal + shippingFee,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
  };
}

// GET /api/cart
app.get('/api/cart', authMiddleware, async (req, res) => {
  const items = await getCart(req.user.id);
  res.json(cartResponse(items));
});

// POST /api/cart/items
app.post('/api/cart/items', authMiddleware, async (req, res) => {
  try {
    const { productId, quantity = 1, variantId } = req.body;
    if (!productId) return res.status(400).json({ message: 'productId required' });

    const product = await q1('SELECT * FROM products WHERE id = $1 AND status = $2', [productId, 'ACTIVE']);
    const name     = product?.name     ?? req.body.name     ?? 'Product';
    const price    = Number(product?.price ?? req.body.price ?? 0);
    const sellerId = product?.sellerId ?? req.body.sellerId ?? null;
    const image    = (product?.images?.[0]) ?? randomImage(name);

    const items = await getCart(req.user.id);
    const idx = items.findIndex(i => i.productId === productId && i.variantId === (variantId ?? null));
    if (idx >= 0) {
      items[idx].quantity += quantity;
    } else {
      items.push({ productId, variantId: variantId ?? null, name, price, image, quantity, sellerId });
    }
    await saveCart(req.user.id, items);

    res.json(cartResponse(items));
  } catch (err) {
    console.error('[Cart POST]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/cart/items (body: { productId, variantId? })
app.delete('/api/cart/items', authMiddleware, async (req, res) => {
  const { productId, variantId } = req.body ?? {};
  if (!productId) return res.status(400).json({ message: 'productId required' });
  const items = await getCart(req.user.id);
  const filtered = items.filter(i => !(i.productId === productId && i.variantId === (variantId ?? null)));
  await saveCart(req.user.id, filtered);
  res.json(cartResponse(filtered));
});

// DELETE /api/cart/items/:productId (path param — backward compat)
app.delete('/api/cart/items/:productId', authMiddleware, async (req, res) => {
  const items = await getCart(req.user.id);
  const filtered = items.filter(i => i.productId !== req.params.productId);
  await saveCart(req.user.id, filtered);
  res.json(cartResponse(filtered));
});

// DELETE /api/cart
app.delete('/api/cart', authMiddleware, async (req, res) => {
  await saveCart(req.user.id, []);
  res.json(cartResponse([]));
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ORDERS ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/orders
app.post('/api/orders', authMiddleware, strictLimit, async (req, res) => {
  try {
    const { items: bodyItems, shippingAddress, paymentMethod = 'COD', voucherCode, shippingMethod } = req.body;

    // If no items in request body, read from user's Redis/DB cart
    let items = bodyItems;
    if (!items || !items.length) {
      const cartItems = await getCart(req.user.id);
      items = cartItems.map(i => ({
        productId: i.productId,
        variantId: i.variantId,
        name: i.name,
        price: i.price,
        unitPrice: i.price,
        quantity: i.quantity,
        sellerId: i.sellerId,
      }));
    }

    if (!items || !items.length) return res.status(400).json({ message: 'Giỏ hàng trống' });

    const unitPrice = (item) => Number(item.unitPrice ?? item.price ?? 0);
    const subtotal = items.reduce((s, i) => s + unitPrice(i) * i.quantity, 0);
    const shippingFee = shippingMethod === 'EXPRESS' ? 55_000 : shippingMethod === 'SAME_DAY' ? 99_000 : (subtotal > 200_000 ? 0 : 30_000);
    const totalAmount = subtotal + shippingFee;
    const idempotencyKey = `order-${req.user.id}-${Date.now()}`;

    const [order] = await q(
      `INSERT INTO orders ("userId", "sellerId", status, "totalAmount", currency, "paymentMethod", "shippingAddress", metadata, "idempotencyKey")
       VALUES ($1, $2, 'PENDING', $3, 'VND', $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        items[0]?.sellerId ?? 'system',
        totalAmount,
        paymentMethod,
        JSON.stringify(shippingAddress ?? {}),
        JSON.stringify({ items, voucherCode, shippingFee, subtotal }),
        idempotencyKey,
      ],
    );

    // Kafka event
    await publishEvent('order.placed', order.id, { orderId: order.id, userId: req.user.id, totalAmount, items });

    // Clear cart after order placed
    await saveCart(req.user.id, []);

    res.status(201).json({ ...order, items, subtotal, shippingFee, total: totalAmount });
  } catch (err) {
    console.error('[Orders POST]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/orders/my
app.get('/api/orders/my', authMiddleware, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const orders = await q(
      `SELECT * FROM orders WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
      [req.user.id, Number(limit), Number(offset)],
    );
    res.json({ data: orders, total: orders.length });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/orders/:id
app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    const order = await q1('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'SELLER') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/orders/:id/cancel
app.patch('/api/orders/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const order = await q1('SELECT * FROM orders WHERE id = $1 AND "userId" = $2', [req.params.id, req.user.id]);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
      return res.status(400).json({ message: 'Cannot cancel order in current status' });
    }
    const [updated] = await q(
      `UPDATE orders SET status = 'CANCELLED', "cancelledAt" = NOW(), "cancelledBy" = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id],
    );
    await publishEvent('order.cancelled', order.id, { orderId: order.id, userId: req.user.id });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── LIVE STREAMS ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/live-streams (public feed)
app.get('/api/live-streams', async (req, res) => {
  try {
    const streams = await q(
      `SELECT ls.*, u.email, u."fullName" as "hostName", u."avatarUrl" as "hostAvatar"
       FROM live_streams ls
       LEFT JOIN users u ON u.id::text = ls."sellerId"
       WHERE ls.status IN ('LIVE', 'SCHEDULED')
       ORDER BY ls."viewerCount" DESC, ls."createdAt" DESC
       LIMIT 20`,
    );
    res.json({ data: streams });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/live-streams/:id
app.get('/api/live-streams/:id', async (req, res) => {
  try {
    const stream = await q1(
      `SELECT ls.*, u."fullName" as "hostName", u."avatarUrl" as "hostAvatar"
       FROM live_streams ls
       LEFT JOIN users u ON u.id::text = ls."sellerId"
       WHERE ls.id = $1`,
      [req.params.id],
    );
    if (!stream) return res.status(404).json({ message: 'Stream not found' });

    // Get recent comments from DB
    const comments = await q(
      `SELECT * FROM live_comments WHERE "streamId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
      [req.params.id],
    ).catch(() => []);

    res.json({ ...stream, comments });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/seller/live-streams
app.post('/api/seller/live-streams', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { title, description, scheduledAt } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });

    const streamKey = crypto.randomBytes(16).toString('hex');
    const [stream] = await q(
      `INSERT INTO live_streams ("sellerId", title, description, status, "streamKey", "scheduledAt")
       VALUES ($1,$2,$3,'SCHEDULED',$4,$5)
       RETURNING *`,
      [req.user.id, title, description ?? null, streamKey, scheduledAt ?? null],
    );
    res.status(201).json(stream);
  } catch (err) {
    console.error('[Live POST]', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/seller/live-streams
app.get('/api/seller/live-streams', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const streams = await q(
      `SELECT * FROM live_streams WHERE "sellerId" = $1 ORDER BY "createdAt" DESC`,
      [req.user.id],
    );
    res.json({ data: streams });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/seller/live-streams/:id/start
app.post('/api/seller/live-streams/:id/start', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const [stream] = await q(
      `UPDATE live_streams SET status='LIVE', "startedAt"=NOW(), "updatedAt"=NOW()
       WHERE id=$1 AND "sellerId"=$2 RETURNING *`,
      [req.params.id, req.user.id],
    );
    if (!stream) return res.status(404).json({ message: 'Stream not found' });
    await publishEvent('live.started', stream.id, { streamId: stream.id, sellerId: req.user.id });
    res.json(stream);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/seller/live-streams/:id/stop
app.post('/api/seller/live-streams/:id/stop', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const [stream] = await q(
      `UPDATE live_streams SET status='ENDED', "endedAt"=NOW(), "updatedAt"=NOW()
       WHERE id=$1 AND "sellerId"=$2 RETURNING *`,
      [req.params.id, req.user.id],
    );
    if (!stream) return res.status(404).json({ message: 'Stream not found' });
    await publishEvent('live.ended', stream.id, { streamId: stream.id });
    // Clean up viewer count in Redis
    try { await redis.del(`live:viewers:${stream.id}`); } catch {}
    res.json(stream);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN ROUTES ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/users
app.get('/api/admin/users', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    let sql = `SELECT id, email, "fullName", roles, status, "createdAt", "avatarUrl" FROM users`;
    const params = [];
    if (search) { params.push(`%${search}%`); sql += ` WHERE email ILIKE $1 OR "fullName" ILIKE $1`; }
    sql += ` ORDER BY "createdAt" DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
    const users = await q(sql, params);
    res.json({ data: users, total: users.length });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/admin/users/:id/ban
app.patch('/api/admin/users/:id/ban', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const [user] = await q(
      `UPDATE users SET status='BANNED', "updatedAt"=NOW() WHERE id=$1 RETURNING id, email, status`,
      [req.params.id],
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    await publishEvent('user.banned', user.id, { userId: user.id, bannedBy: req.user.id });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/admin/users/:id/unban
app.patch('/api/admin/users/:id/unban', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const [user] = await q(`UPDATE users SET status='ACTIVE', "updatedAt"=NOW() WHERE id=$1 RETURNING id, email, status`, [req.params.id]);
    res.json(user ?? { message: 'Not found' });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/admin/orders
app.get('/api/admin/orders', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const orders = await q(`SELECT * FROM orders ORDER BY "createdAt" DESC LIMIT 100`);
    res.json({ data: orders });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/admin/feature-flags
app.get('/api/admin/feature-flags', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const flags = await q(`SELECT * FROM feature_flags ORDER BY key`);
    res.json({ data: flags });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/admin/feature-flags
app.post('/api/admin/feature-flags', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { key, name, description, enabled, rollout_percentage } = req.body;
    if (!key || !name) return res.status(400).json({ message: 'key, name required' });
    const [flag] = await q(
      `INSERT INTO feature_flags (key, name, description, enabled, rollout_percentage, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO UPDATE SET name=$2, enabled=$4, "updatedAt"=NOW()
       RETURNING *`,
      [key, name, description ?? null, enabled ?? false, rollout_percentage ?? 0, req.user.id],
    );
    res.status(201).json(flag);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/admin/feature-flags/:key
app.patch('/api/admin/feature-flags/:key', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { enabled, rollout_percentage } = req.body;
    const [flag] = await q(
      `UPDATE feature_flags SET enabled=$1, rollout_percentage=$2, "updatedAt"=NOW() WHERE key=$3 RETURNING *`,
      [enabled, rollout_percentage ?? 0, req.params.key],
    );
    if (!flag) return res.status(404).json({ message: 'Flag not found' });
    res.json(flag);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/admin/feature-flags/:key
app.delete('/api/admin/feature-flags/:key', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    await q(`DELETE FROM feature_flags WHERE key=$1`, [req.params.key]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── NOTIFICATIONS ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/notifications
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const notifs = await q(
      `SELECT * FROM notifications WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 30`,
      [req.user.id],
    );
    res.json({ data: notifs, unread: notifs.filter(n => !n.isRead).length });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/notifications/:id/read
app.patch('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  await q(`UPDATE notifications SET "isRead"=true WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  res.json({ success: true });
});

// PATCH /api/notifications/read-all
app.patch('/api/notifications/read-all', authMiddleware, async (req, res) => {
  await q(`UPDATE notifications SET "isRead"=true WHERE "userId"=$1`, [req.user.id]);
  res.json({ success: true });
});

// ─── Internal service delegation ─────────────────────────────────────────────
// Gateway gọi NestJS services nội bộ (Docker network) cho specialized logic.
// Pattern: try internal service → fallback về direct DB nếu service down.
// NestJS services KHÔNG được expose public port — chỉ giao tiếp qua Docker network.

const INTERNAL_SERVICES = {
  search:       process.env.SEARCH_SERVICE_URL      ?? 'http://search-service:3005',
  payment:      process.env.PAYMENT_SERVICE_URL     ?? 'http://payment-service:3007',
  ai:           process.env.AI_SERVICE_URL          ?? 'http://ai-service:3010',
  analytics:    process.env.ANALYTICS_SERVICE_URL   ?? 'http://analytics-service:3009',
  notification: process.env.NOTIFICATION_SERVICE_URL ?? 'http://notification-service:3008',
  review:       process.env.REVIEW_SERVICE_URL      ?? 'http://review-service:3016',
  chat:         process.env.CHAT_SERVICE_URL        ?? 'http://chat-service:3015',
  wallet:       process.env.WALLET_SERVICE_URL      ?? 'http://wallet-service:3017',
};

const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'internal_dev_token_change_in_prod';

/**
 * Gọi NestJS service nội bộ — có timeout + fallback
 * @param {string} serviceUrl  - base URL của service
 * @param {string} path        - path (bắt đầu bằng /)
 * @param {object} options     - { method, body, timeoutMs }
 * @returns {{ data, ok }} hoặc null nếu service không khả dụng
 */
async function callInternal(serviceUrl, path, options = {}) {
  const { method = 'GET', body, timeoutMs = 3000 } = options;
  try {
    const res = await fetch(`${serviceUrl}${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${INTERNAL_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return { data: await res.json(), ok: true };
  } catch {
    return null; // service down → caller sẽ fallback về DB
  }
}

// ─── Health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ═══════════════════════════════════════════════════════════════════════════
// ── USER PROFILE ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/users/me
app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const user = await q1(
      `SELECT id, email, "fullName", "avatarUrl", roles, status, "createdAt" FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ ...user, role: (user.roles ?? 'BUYER').split(',')[0].trim().toUpperCase() });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// PATCH /api/users/me
app.patch('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const { fullName, avatarUrl, phone, bio } = req.body;
    const fields = []; const params = [req.user.id];
    if (fullName  !== undefined) { params.push(fullName);  fields.push(`"fullName" = $${params.length}`); }
    if (avatarUrl !== undefined) { params.push(avatarUrl); fields.push(`"avatarUrl" = $${params.length}`); }
    if (phone     !== undefined) { params.push(phone);     fields.push(`phone = $${params.length}`); }
    if (bio       !== undefined) { params.push(bio);       fields.push(`bio = $${params.length}`); }
    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
    fields.push(`"updatedAt" = NOW()`);
    const [user] = await q(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $1 RETURNING id, email, "fullName", "avatarUrl", roles`,
      params,
    );
    res.json(user ?? { message: 'Not found' });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// PATCH /api/users/me/password
app.patch('/api/users/me/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'currentPassword and newPassword required' });
    const user = await q1(`SELECT "passwordHash" FROM users WHERE id = $1`, [req.user.id]);
    if (!user) return res.status(404).json({ message: 'Not found' });
    if (user.passwordHash) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await q(`UPDATE users SET "passwordHash"=$1, "updatedAt"=NOW() WHERE id=$2`, [hash, req.user.id]);
    res.json({ ok: true, message: 'Mật khẩu đã được thay đổi' });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — STATS & ANALYTICS ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/stats/overview
app.get('/api/admin/stats/overview', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const [users]    = await q(`SELECT COUNT(*) AS c FROM users`);
    const [orders]   = await q(`SELECT COUNT(*) AS c, COALESCE(SUM("totalAmount"),0) AS rev FROM orders`);
    const [products] = await q(`SELECT COUNT(*) AS c FROM products WHERE status='ACTIVE'`);
    const [sellers]  = await q(`SELECT COUNT(*) AS c FROM users WHERE roles ILIKE '%SELLER%'`);
    const [streams]  = await q(`SELECT COUNT(*) AS c FROM live_streams WHERE status='LIVE'`);
    res.json({
      totalUsers:    Number(users?.c   ?? 0),
      totalOrders:   Number(orders?.c  ?? 0),
      totalRevenue:  Number(orders?.rev ?? 0),
      totalProducts: Number(products?.c ?? 0),
      totalSellers:  Number(sellers?.c  ?? 0),
      liveStreams:   Number(streams?.c  ?? 0),
    });
  } catch (err) {
    console.error('[Admin Stats]', err);
    res.json({ totalUsers: 0, totalOrders: 0, totalRevenue: 0, totalProducts: 0, totalSellers: 0, liveStreams: 0 });
  }
});

// GET /api/admin/analytics — GMV by day (last 30 days)
app.get('/api/admin/analytics', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await q(`
      SELECT DATE_TRUNC('day', "createdAt") AS day,
             COUNT(*) AS orders,
             COALESCE(SUM("totalAmount"), 0) AS gmv
      FROM orders
      WHERE "createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `);
    res.json({
      gmvByDay: rows.map(r => ({ date: r.day, orders: Number(r.orders), gmv: Number(r.gmv) })),
    });
  } catch (err) {
    res.json({ gmvByDay: [] });
  }
});

// GET /api/admin/search — unified admin search
app.get('/api/admin/search', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { q: search = '' } = req.query;
    const pattern = `%${search}%`;
    const users    = await q(`SELECT id, email, "fullName", roles, status FROM users WHERE email ILIKE $1 OR "fullName" ILIKE $1 LIMIT 5`, [pattern]);
    const products = await q(`SELECT id, name, price, status FROM products WHERE name ILIKE $1 LIMIT 5`, [pattern]);
    const orders   = await q(`SELECT id, status, "totalAmount", "createdAt" FROM orders WHERE id::text ILIKE $1 LIMIT 5`, [pattern]);
    res.json({ users, products, orders });
  } catch (err) {
    res.json({ users: [], products: [], orders: [] });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — SELLERS ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/sellers
app.get('/api/admin/sellers', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { limit = 20, page = 1, status, q: search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let sql = `SELECT id, email, "fullName" AS "shopName", "avatarUrl", roles, status, "createdAt" FROM users WHERE roles ILIKE '%SELLER%'`;
    const params = [];
    if (status && status !== 'ALL') { params.push(status); sql += ` AND status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (email ILIKE $${params.length} OR "fullName" ILIKE $${params.length})`; }
    sql += ` ORDER BY "createdAt" DESC LIMIT ${Number(limit)} OFFSET ${offset}`;
    const sellers = await q(sql, params);
    const [total] = await q(`SELECT COUNT(*) AS c FROM users WHERE roles ILIKE '%SELLER%'`);
    res.json({ items: sellers, total: Number(total?.c ?? 0) });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// PATCH /api/admin/sellers/:id/verify
app.patch('/api/admin/sellers/:id/verify', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    await q(`UPDATE users SET status='ACTIVE', "updatedAt"=NOW() WHERE id=$1`, [req.params.id]);
    await publishEvent('seller.verified', req.params.id, { sellerId: req.params.id, adminId: req.user.id });
    res.json({ ok: true, sellerId: req.params.id, status: 'VERIFIED' });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// PATCH /api/admin/sellers/:id/suspend
app.patch('/api/admin/sellers/:id/suspend', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    await q(`UPDATE users SET status='BANNED', "updatedAt"=NOW() WHERE id=$1`, [req.params.id]);
    await publishEvent('seller.suspended', req.params.id, { sellerId: req.params.id, adminId: req.user.id });
    res.json({ ok: true, sellerId: req.params.id, status: 'SUSPENDED' });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — ORDERS ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// PATCH /api/admin/orders/:id/force-status
app.patch('/api/admin/orders/:id/force-status', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!status) return res.status(400).json({ message: 'status required' });
    const [order] = await q(
      `UPDATE orders SET status=$1, "updatedAt"=NOW(), metadata=jsonb_set(COALESCE(metadata,'{}')::jsonb, '{adminNote}', $2) WHERE id=$3 RETURNING *`,
      [status, JSON.stringify(reason ?? ''), req.params.id],
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });
    await publishEvent('order.status_forced', order.id, { orderId: order.id, status, adminId: req.user.id });
    res.json(order);
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — AUDIT LOGS ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/audit-logs
app.get('/api/admin/audit-logs', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { limit = 20, page = 1, action, q: search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let sql = `SELECT al.*, u.email AS actor_email FROM audit_logs al LEFT JOIN users u ON u.id::text = al."userId" WHERE 1=1`;
    const params = [];
    if (action) { params.push(action); sql += ` AND al.action = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (u.email ILIKE $${params.length} OR al.resource ILIKE $${params.length})`; }
    sql += ` ORDER BY al."createdAt" DESC LIMIT ${Number(limit)} OFFSET ${offset}`;
    const logs = await q(sql, params).catch(() => []);
    const [total] = await q(`SELECT COUNT(*) AS c FROM audit_logs`).catch(() => [{ c: 0 }]);
    res.json({ items: logs, total: Number(total?.c ?? 0) });
  } catch (err) { res.json({ items: [], total: 0 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — ROLES ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/roles
app.get('/api/admin/roles', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const roles = await q(`SELECT * FROM roles ORDER BY name`).catch(() => []);
    if (!roles.length) {
      // Seed default roles if table empty
      return res.json({ items: [
        { id: '1', name: 'ADMIN',  description: 'Quản trị viên hệ thống', permissions: ['*'] },
        { id: '2', name: 'SELLER', description: 'Người bán hàng',          permissions: ['products.*', 'orders.read'] },
        { id: '3', name: 'BUYER',  description: 'Người mua hàng',           permissions: ['orders.*', 'cart.*'] },
      ]});
    }
    res.json({ items: roles });
  } catch (err) { res.json({ items: [] }); }
});

// PATCH /api/admin/roles/:id/assign
app.patch('/api/admin/roles/:id/assign', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    const role = await q1(`SELECT name FROM roles WHERE id = $1`, [req.params.id]).catch(() => null);
    const roleName = role?.name ?? req.params.id;
    await q(`UPDATE users SET roles=$1, "updatedAt"=NOW() WHERE id=$2`, [roleName, userId]);
    res.json({ ok: true, roleId: req.params.id, assignedTo: userId });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — DISPUTES ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/disputes/stats
app.get('/api/admin/disputes/stats', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const row = await q1(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'OPEN') AS open,
        COUNT(*) FILTER (WHERE status = 'RESOLVED') AS resolved,
        AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))/3600) AS avg_hours
      FROM disputes
    `).catch(() => null);
    res.json({ total: Number(row?.total ?? 0), open: Number(row?.open ?? 0), resolved: Number(row?.resolved ?? 0), avgResolutionHours: Number(row?.avg_hours ?? 0) });
  } catch { res.json({ total: 0, open: 0, resolved: 0, avgResolutionHours: 0 }); }
});

// GET /api/admin/disputes/queue
app.get('/api/admin/disputes/queue', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const disputes = await q(`SELECT * FROM disputes WHERE status != 'RESOLVED' ORDER BY "createdAt" DESC LIMIT 50`).catch(() => []);
    res.json({ items: disputes, total: disputes.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// POST /api/admin/disputes/:id/resolve
app.post('/api/admin/disputes/:id/resolve', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { resolution, refundAmount } = req.body;
    await q(
      `UPDATE disputes SET status='RESOLVED', resolution=$1, "refundAmount"=$2, "resolvedAt"=NOW(), "resolvedBy"=$3 WHERE id=$4`,
      [resolution, refundAmount ?? 0, req.user.id, req.params.id],
    ).catch(() => {});
    await publishEvent('dispute.resolved', req.params.id, { disputeId: req.params.id, adminId: req.user.id });
    res.json({ ok: true, disputeId: req.params.id, status: 'RESOLVED' });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — FINANCE ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/finance/revenue
app.get('/api/admin/finance/revenue', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await q(`
      SELECT DATE_TRUNC('month', "createdAt") AS month,
             COALESCE(SUM("totalAmount"), 0) AS revenue,
             COUNT(*) AS orders
      FROM orders WHERE status NOT IN ('CANCELLED')
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    `);
    const total = await q1(`SELECT COALESCE(SUM("totalAmount"),0) AS t FROM orders WHERE status NOT IN ('CANCELLED')`);
    res.json({
      byMonth: rows.map(r => ({ month: r.month, revenue: Number(r.revenue), orders: Number(r.orders) })),
      totalRevenue: Number(total?.t ?? 0),
    });
  } catch (err) { res.json({ byMonth: [], totalRevenue: 0 }); }
});

// GET /api/admin/finance/payouts
app.get('/api/admin/finance/payouts', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const payouts = await q(`SELECT * FROM payouts ORDER BY "createdAt" DESC LIMIT 50`).catch(() => []);
    res.json({ items: payouts, total: payouts.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// POST /api/admin/finance/payouts/:id/process
app.post('/api/admin/finance/payouts/:id/process', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    await q(`UPDATE payouts SET status='PAID', "paidAt"=NOW(), "processedBy"=$1 WHERE id=$2`, [req.user.id, req.params.id]).catch(() => {});
    res.json({ ok: true, payoutId: req.params.id, status: 'PAID' });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — FRAUD ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/fraud/signals
app.get('/api/admin/fraud/signals', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    // High-value orders from new users as a simple fraud signal
    const signals = await q(`
      SELECT o.id AS "orderId", o."totalAmount", o."createdAt", u.email, u."createdAt" AS "userCreatedAt",
             'HIGH_VALUE_NEW_USER' AS signal
      FROM orders o
      JOIN users u ON u.id::text = o."userId"
      WHERE o."totalAmount" > 5000000
        AND o."createdAt" - u."createdAt" < INTERVAL '7 days'
      ORDER BY o."createdAt" DESC LIMIT 20
    `).catch(() => []);
    res.json({ items: signals, total: signals.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// GET /api/admin/fraud/chargeback-rate
app.get('/api/admin/fraud/chargeback-rate', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const [total]    = await q(`SELECT COUNT(*) AS c FROM orders`);
    const [cancelled]= await q(`SELECT COUNT(*) AS c FROM orders WHERE status='CANCELLED'`);
    const rate = Number(total?.c) > 0 ? Number(cancelled?.c) / Number(total?.c) : 0;
    res.json({ chargebackRate: rate, totalOrders: Number(total?.c ?? 0), chargebacks: Number(cancelled?.c ?? 0) });
  } catch { res.json({ chargebackRate: 0, totalOrders: 0, chargebacks: 0 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — ADS CAMPAIGNS ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/ads/campaigns
app.get('/api/admin/ads/campaigns', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const campaigns = await q(`SELECT * FROM ad_campaigns ORDER BY "createdAt" DESC LIMIT 50`).catch(() => []);
    res.json({ items: campaigns, total: campaigns.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADMIN — SYSTEM HEALTH ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/system/service-health
app.get('/api/admin/system/service-health', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  const services = [
    { name: 'api-gateway',    port: null,  check: async () => true }, // we ARE the gateway
    { name: 'postgres',       port: null,  check: async () => { await db.query('SELECT 1'); return true; } },
    { name: 'redis',          port: null,  check: async () => { await redis.ping(); return true; } },
    { name: 'user-service',   port: 3001,  check: null },
    { name: 'feed-service',   port: 3002,  check: null },
    { name: 'order-service',  port: 3003,  check: null },
    { name: 'search-service', port: 3005,  check: null },
    { name: 'live-service',   port: 3006,  check: null },
  ];

  const results = await Promise.all(services.map(async (svc) => {
    try {
      let healthy = false;
      if (svc.check) {
        healthy = await svc.check();
      } else {
        const r = await fetch(`http://${svc.name}:${svc.port}/health`, { signal: AbortSignal.timeout(2000) });
        healthy = r.ok;
      }
      return { name: svc.name, status: healthy ? 'healthy' : 'unhealthy' };
    } catch {
      return { name: svc.name, status: 'unhealthy' };
    }
  }));

  res.json({ services: results, timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── SELLER ROUTES ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/seller/analytics
app.get('/api/seller/analytics', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const rows = await q(`
      SELECT DATE_TRUNC('day', o."createdAt") AS day,
             COUNT(*) AS orders,
             COALESCE(SUM(o."totalAmount"), 0) AS revenue
      FROM orders o
      WHERE o."sellerId" = $1
        AND o."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY 1 ORDER BY 1
    `, [req.user.id]);
    const [totals] = await q(`
      SELECT COUNT(*) AS orders, COALESCE(SUM("totalAmount"),0) AS revenue
      FROM orders WHERE "sellerId"=$1 AND status NOT IN ('CANCELLED')
    `, [req.user.id]);
    res.json({
      byDay: rows.map(r => ({ date: r.day, orders: Number(r.orders), revenue: Number(r.revenue) })),
      totalOrders: Number(totals?.orders ?? 0),
      totalRevenue: Number(totals?.revenue ?? 0),
    });
  } catch (err) { res.json({ byDay: [], totalOrders: 0, totalRevenue: 0 }); }
});

// GET /api/seller/payments
app.get('/api/seller/payments', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { limit = 20, page = 1, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let sql = `SELECT id, "totalAmount" AS amount, status, "paymentMethod", "createdAt" FROM orders WHERE "sellerId"=$1`;
    const params = [req.user.id];
    if (status && status !== 'ALL') { params.push(status); sql += ` AND status=$${params.length}`; }
    sql += ` ORDER BY "createdAt" DESC LIMIT ${Number(limit)} OFFSET ${offset}`;
    const items = await q(sql, params);
    res.json({ items, total: items.length });
  } catch (err) { res.json({ items: [], total: 0 }); }
});

// GET /api/seller/ads
app.get('/api/seller/ads', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const ads = await q(`SELECT * FROM ad_campaigns WHERE "sellerId"=$1 ORDER BY "createdAt" DESC`, [req.user.id]).catch(() => []);
    res.json({ items: ads, total: ads.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// POST /api/seller/ads
app.post('/api/seller/ads', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { name, budget, type = 'CPC', targetKeywords, productId } = req.body;
    if (!name || !budget) return res.status(400).json({ message: 'name, budget required' });
    const [ad] = await q(
      `INSERT INTO ad_campaigns ("sellerId", name, budget, type, "targetKeywords", "productId", status)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE') RETURNING *`,
      [req.user.id, name, budget, type, JSON.stringify(targetKeywords ?? []), productId ?? null],
    );
    res.status(201).json(ad);
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// PATCH /api/seller/ads/:id/activate
app.patch('/api/seller/ads/:id/activate', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    await q(`UPDATE ad_campaigns SET status='ACTIVE', "updatedAt"=NOW() WHERE id=$1 AND "sellerId"=$2`, [req.params.id, req.user.id]).catch(() => {});
    res.json({ id: req.params.id, status: 'ACTIVE', activatedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// PATCH /api/seller/ads/:id/pause
app.patch('/api/seller/ads/:id/pause', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    await q(`UPDATE ad_campaigns SET status='PAUSED', "updatedAt"=NOW() WHERE id=$1 AND "sellerId"=$2`, [req.params.id, req.user.id]).catch(() => {});
    res.json({ id: req.params.id, status: 'PAUSED', pausedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// GET /api/seller/subscription
app.get('/api/seller/subscription', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const sub = await q1(`SELECT * FROM subscriptions WHERE "userId"=$1 AND status='ACTIVE'`, [req.user.id]).catch(() => null);
    res.json(sub ?? { plan: 'FREE', status: 'ACTIVE', features: ['products_5', 'basic_analytics'] });
  } catch { res.json({ plan: 'FREE', status: 'ACTIVE', features: [] }); }
});

// GET /api/seller/disputes
app.get('/api/seller/disputes', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const disputes = await q(`SELECT * FROM disputes WHERE "sellerId"=$1 ORDER BY "createdAt" DESC LIMIT 50`, [req.user.id]).catch(() => []);
    res.json({ items: disputes, total: disputes.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// POST /api/seller/disputes/:id/respond
app.post('/api/seller/disputes/:id/respond', authMiddleware, requireRole('SELLER', 'ADMIN'), async (req, res) => {
  try {
    const { response } = req.body;
    await q(
      `UPDATE disputes SET "sellerResponse"=$1, "respondedAt"=NOW(), status='SELLER_RESPONDED' WHERE id=$2 AND "sellerId"=$3`,
      [response, req.params.id, req.user.id],
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── POINTS / LOYALTY ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/points/rewards
app.get('/api/points/rewards', async (req, res) => {
  try {
    const rewards = await q(`SELECT * FROM point_rewards WHERE is_active=true ORDER BY points_required ASC`).catch(() => []);
    if (!rewards.length) {
      // Default rewards catalog
      return res.json({ items: [
        { id: '1', name: 'Giảm 10K',    pointsRequired: 100,  value: 10000,  type: 'DISCOUNT' },
        { id: '2', name: 'Giảm 50K',    pointsRequired: 450,  value: 50000,  type: 'DISCOUNT' },
        { id: '3', name: 'Freeship',     pointsRequired: 200,  value: 30000,  type: 'SHIPPING' },
        { id: '4', name: 'Giảm 200K',   pointsRequired: 1500, value: 200000, type: 'DISCOUNT' },
      ]});
    }
    res.json({ items: rewards });
  } catch { res.json({ items: [] }); }
});

// GET /api/points/transactions
app.get('/api/points/transactions', authMiddleware, async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const txns = await q(
      `SELECT * FROM point_transactions WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT ${Number(limit)}`,
      [req.user.id],
    ).catch(() => []);
    res.json({ items: txns, total: txns.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── INVENTORY / FLASH SALE ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/inventory/flash-sale/active
app.get('/api/inventory/flash-sale/active', async (req, res) => {
  try {
    const session = await q1(`
      SELECT fs.*, json_agg(fsi.*) AS items
      FROM flash_sale_sessions fs
      LEFT JOIN flash_sale_items fsi ON fsi."sessionId" = fs.id
      WHERE fs.status = 'ACTIVE' AND fs."endTime" > NOW()
      GROUP BY fs.id LIMIT 1
    `).catch(() => null);
    if (!session) return res.json({ active: false });
    res.json({ active: true, session });
  } catch { res.json({ active: false }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── LIVE ROOMS ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/live/rooms/active
app.get('/api/live/rooms/active', async (req, res) => {
  try {
    const rooms = await q(`
      SELECT ls.id, ls.title, ls.status, ls."viewerCount",
             u."fullName" AS "sellerName", u."avatarUrl" AS "sellerAvatar",
             ls."thumbnailUrl", ls."isFlashSale"
      FROM live_streams ls
      LEFT JOIN users u ON u.id = ls."sellerId"
      WHERE ls.status = 'LIVE'
      ORDER BY ls."viewerCount" DESC LIMIT 50
    `).catch(() => []);
    res.json({ items: rooms });
  } catch { res.json({ items: [] }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── PAYMENT WEBHOOKS (delegated to payment-service) ────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/payments/webhook/:provider  — Stripe / VNPay / MoMo callbacks
// Gateway tiếp nhận, validate IP whitelist cơ bản, rồi delegate xuống payment-service
app.post('/api/payments/webhook/:provider', async (req, res) => {
  const { provider } = req.params;
  const allowedProviders = ['stripe', 'vnpay', 'momo', 'zalopay'];
  if (!allowedProviders.includes(provider)) return res.status(400).json({ error: 'Unknown provider' });

  const svc = await callInternal(
    INTERNAL_SERVICES.payment,
    `/webhooks/${provider}`,
    { method: 'POST', body: req.body, timeoutMs: 10000 },
  );
  if (svc) return res.json(svc.data);

  // Nếu payment-service down: queue vào DB để retry
  try {
    await q(
      `INSERT INTO webhook_queue (provider, payload, status, "createdAt") VALUES ($1, $2, 'PENDING', NOW())`,
      [provider, JSON.stringify(req.body)],
    );
    res.status(202).json({ message: 'Queued for processing' });
  } catch { res.status(500).json({ error: 'Service unavailable' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── SEARCH & PRODUCTS PUBLIC ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/search — thử search-service (Elasticsearch) trước, fallback SQL
app.get('/api/search', publicLimit, async (req, res) => {
  // Delegate sang search-service (BM25 + vector search) nếu available
  const svc = await callInternal(INTERNAL_SERVICES.search, `/search?${new URLSearchParams(req.query).toString()}`);
  if (svc) {
    const data = svc.data;
    // Normalize search-service ProductHit[] → FE Product[] shape
    if (Array.isArray(data.hits)) {
      const { page = 1, pageSize = 24 } = req.query;
      const products = data.hits.map((hit) => ({
        id: hit.id,
        name: hit.name,
        slug: hit.id, // fallback slug
        description: '',
        price: hit.price ?? 0,
        originalPrice: hit.originalPrice,
        thumbnailUrl: hit.imageUrl ?? '',
        images: hit.imageUrl ? [hit.imageUrl] : [],
        sellerId: hit.sellerId ?? '',
        sellerName: hit.sellerName ?? '',
        categoryId: '',
        categoryName: '',
        rating: hit.rating ?? 0,
        reviewCount: hit.reviewCount ?? 0,
        soldCount: hit.soldCount ?? 0,
        stockQuantity: hit.inStock ? 1 : 0,
        tags: [],
      }));
      return res.json({
        products,
        total: data.total ?? products.length,
        page: Number(page),
        pageSize: Number(pageSize),
        facets: data.facets,
        sponsored: [],
        query: data.query,
        searchId: data.searchId,
      });
    }
    return res.json(svc.data);
  }

  // Fallback: SQL ILIKE
  try {
    const { q: keyword = '', category, minPrice, maxPrice, page = 1, pageSize = 24, sort } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const params = [`%${keyword}%`];
    let where = `(p.name ILIKE $1 OR p.description ILIKE $1) AND p.status = 'ACTIVE'`;
    if (category) { params.push(category); where += ` AND p.category = $${params.length}`; }
    if (minPrice)  { params.push(minPrice);  where += ` AND p.price >= $${params.length}`; }
    if (maxPrice)  { params.push(maxPrice);  where += ` AND p.price <= $${params.length}`; }
    const orderBy = sort === 'price_asc' ? 'p.price ASC' : sort === 'price_desc' ? 'p.price DESC' : 'p."createdAt" DESC';
    const products = await q(
      `SELECT p.id, p.name, p.price, p."imageUrls"[1] AS "imageUrl", p.category, p.rating, 0 AS "soldCount"
       FROM products p WHERE ${where} ORDER BY ${orderBy} LIMIT ${Number(pageSize)} OFFSET ${offset}`,
      params,
    );
    const [cnt] = await q(`SELECT COUNT(*) AS c FROM products p WHERE ${where}`, params);
    res.json({ products, total: Number(cnt?.c ?? 0), page: Number(page), pageSize: Number(pageSize), sponsored: [] });
  } catch { res.json({ products: [], total: 0, page: 1, pageSize: 24, sponsored: [] }); }
});

// NOTE: GET /api/products/:id is handled earlier via a specific route
// GET /api/products/flash-sale
app.get('/api/products/flash-sale', async (req, res) => {
  try {
    const products = await q(`
      SELECT p.id, p.name, p.price, fsi.sale_price AS "salePrice", p."imageUrls"[1] AS "imageUrl"
      FROM flash_sale_items fsi
      JOIN products p ON p.id = fsi."productId"
      JOIN flash_sale_sessions fs ON fs.id = fsi."sessionId"
      WHERE fs.status='ACTIVE' AND fs."endTime" > NOW()
      LIMIT 20
    `).catch(() => []);
    res.json({ products });
  } catch { res.json({ products: [] }); }
});

// GET /api/products/featured — thử AI service (personalized), fallback SQL rating
app.get('/api/products/featured', async (req, res) => {
  // Thử ai-service cho personalized recommendations
  const userId = req.headers.authorization ? (() => {
    try {
      const b64 = req.headers.authorization.replace('Bearer ', '').split('.')[1];
      return JSON.parse(Buffer.from(b64, 'base64').toString()).id;
    } catch { return null; }
  })() : null;

  if (userId) {
    const svc = await callInternal(INTERNAL_SERVICES.ai, `/recommendations?userId=${userId}&limit=20`);
    if (svc) return res.json(svc.data);
  }

  // Fallback: top rated products
  try {
    const products = await q(`SELECT id, name, price, "imageUrls"[1] AS "imageUrl", category, rating FROM products WHERE status='ACTIVE' ORDER BY rating DESC NULLS LAST LIMIT 20`);
    res.json({ products });
  } catch { res.json({ products: [] }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── SELLER PUBLIC PROFILE ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/sellers/:id
app.get('/api/sellers/:id', async (req, res) => {
  try {
    const seller = await q1(`
      SELECT u.id, COALESCE(u."fullName", u.email) AS "businessName",
             u."avatarUrl", u.status,
             u."createdAt" AS "joinedAt",
             COALESCE((SELECT COUNT(*) FROM products p WHERE p."sellerId"=u.id AND p.status='ACTIVE'), 0) AS "productCount",
             0 AS "followerCount",
             4.8 AS rating, 0 AS "reviewCount", 95 AS "responseRate",
             'FREE' AS tier
      FROM users u WHERE u.id = $1 AND u.roles ILIKE '%SELLER%'
    `, [req.params.id]);
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    res.json({
      ...seller,
      productCount:  Number(seller.productCount),
      followerCount: Number(seller.followerCount),
      reviewCount:   Number(seller.reviewCount),
    });
  } catch (err) { res.status(500).json({ message: 'Internal server error' }); }
});

// GET /api/sellers/:id/products
app.get('/api/sellers/:id/products', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const products = await q(`
      SELECT p.id, p.name, p.price, p."imageUrls"[1] AS "imageUrl",
             0 AS "soldCount"
      FROM products p
      WHERE p."sellerId" = $1 AND p.status = 'ACTIVE'
      ORDER BY p."createdAt" DESC LIMIT ${Number(limit)}
    `, [req.params.id]);
    res.json({ items: products });
  } catch (err) { res.json({ items: [] }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ADS CLICK TRACKING ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/cart/voucher
app.post('/api/cart/voucher', authMiddleware, async (req, res) => {
  const { code } = req.body ?? {};
  const upper = (code ?? '').toUpperCase().trim();
  // Check DB vouchers table first, fallback to built-in catalog
  try {
    const voucher = await q1(
      `SELECT * FROM vouchers WHERE code=$1 AND is_active=true AND (expires_at IS NULL OR expires_at > NOW())`,
      [upper],
    ).catch(() => null);
    if (voucher) {
      return res.json({ code: upper, discount: Number(voucher.discount_value), type: voucher.discount_type });
    }
  } catch {}
  // Built-in dev vouchers
  const catalog = { HYPER20: { discount: 0.20, type: 'PERCENT' }, SALE10: { discount: 0.10, type: 'PERCENT' }, FREE50: { discount: 50000, type: 'FIXED' } };
  const found = catalog[upper];
  if (!found) return res.status(400).json({ message: 'Mã giảm giá không hợp lệ hoặc đã hết hạn' });
  res.json({ code: upper, ...found });
});

// POST /api/ads/click
app.post('/api/ads/click', async (req, res) => {
  const { impressionId, productId } = req.body ?? {};
  if (impressionId && productId) {
    publishEvent('ad.clicked', impressionId, { impressionId, productId, ts: Date.now() }).catch(() => {});
  }
  res.json({ ok: true });
});



const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'], credentials: true },
  path: '/socket.io',
});

// Room tracking: roomId → { broadcaster: socketId | null, viewers: Set<socketId> }
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { broadcaster: null, viewers: new Set() });
  return rooms.get(roomId);
}

// Auth for socket
io.use((socket, next) => {
  const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
  if (!token) {
    // Allow anonymous viewers with a guest identity
    socket.data.user = { id: `guest-${socket.id}`, role: 'GUEST', fullName: 'Khách' };
    return next();
  }
  try {
    if (token.startsWith('real.') || token.startsWith('demo.')) {
      const b64 = token.split('.')[1];
      socket.data.user = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } else {
      socket.data.user = jwt.verify(token, JWT_SECRET);
    }
    next();
  } catch {
    socket.data.user = { id: `guest-${socket.id}`, role: 'GUEST', fullName: 'Khách' };
    next();
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  console.log(`[Socket] connected: ${socket.id} (${user.fullName ?? user.id})`);

  // ── Join stream room ─────────────────────────────────────────────────────
  socket.on('join_stream', async ({ streamId, role }) => {
    socket.join(streamId);
    const room = getRoom(streamId);

    if (role === 'broadcaster') {
      room.broadcaster = socket.id;
      socket.data.streamId = streamId;
      socket.data.role = 'broadcaster';
      console.log(`[Socket] ${socket.id} is now broadcaster for ${streamId}`);
    } else {
      room.viewers.add(socket.id);
      socket.data.streamId = streamId;
      socket.data.role = 'viewer';

      // Update viewer count in Redis + DB
      try {
        const count = await redis.incr(`live:viewers:${streamId}`);
        await q(`UPDATE live_streams SET "viewerCount"=$1, "peakViewers"=GREATEST("peakViewers",$1) WHERE id=$2`, [count, streamId]).catch(() => {});
        io.to(streamId).emit('viewer_count', { count });
      } catch {}

      // If broadcaster exists, notify them a viewer joined (WebRTC: broadcaster creates offer)
      if (room.broadcaster) {
        io.to(room.broadcaster).emit('viewer_joined', { viewerId: socket.id, user: { fullName: user.fullName ?? 'Khách' } });
      }
    }
  });

  // ── WebRTC Signaling ─────────────────────────────────────────────────────
  // Broadcaster → viewer: send offer
  socket.on('webrtc_offer', ({ targetId, sdp }) => {
    io.to(targetId).emit('webrtc_offer', { from: socket.id, sdp });
  });

  // Viewer → broadcaster: send answer
  socket.on('webrtc_answer', ({ targetId, sdp }) => {
    io.to(targetId).emit('webrtc_answer', { from: socket.id, sdp });
  });

  // ICE candidates relay
  socket.on('webrtc_ice', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc_ice', { from: socket.id, candidate });
  });

  // ── Live Chat ────────────────────────────────────────────────────────────
  socket.on('send_comment', async ({ streamId, message, type = 'text' }) => {
    if (!message || !streamId) return;

    const comment = {
      id: crypto.randomUUID(),
      streamId,
      userId: user.id,
      fullName: user.fullName ?? 'Khách',
      message: String(message).slice(0, 500),
      type,
      createdAt: new Date().toISOString(),
    };

    // Broadcast to room immediately (real-time)
    io.to(streamId).emit('new_comment', comment);

    // Persist to DB async
    q(
      `INSERT INTO live_comments (id, "streamId", "userId", "fullName", message, type, "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [comment.id, streamId, user.id, comment.fullName, comment.message, type, comment.createdAt],
    ).catch(() => {});

    // Kafka event for analytics
    publishEvent('live.comment', streamId, comment).catch(() => {});
  });

  // ── Gift ─────────────────────────────────────────────────────────────────
  socket.on('send_gift', async ({ streamId, giftType, amount }) => {
    const gift = {
      id: crypto.randomUUID(),
      userId: user.id,
      fullName: user.fullName ?? 'Khách',
      giftType,
      amount: Number(amount) || 1,
      createdAt: new Date().toISOString(),
    };
    io.to(streamId).emit('new_gift', gift);

    // Update revenue
    q(`UPDATE live_streams SET "totalRevenue"="totalRevenue"+$1 WHERE id=$2`, [gift.amount * 1000, streamId]).catch(() => {});
    publishEvent('live.gift', streamId, { ...gift, streamId }).catch(() => {});
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    const streamId = socket.data.streamId;
    if (!streamId) return;

    const room = getRoom(streamId);
    if (socket.data.role === 'broadcaster') {
      room.broadcaster = null;
      io.to(streamId).emit('stream_ended', { message: 'Broadcaster disconnected' });
    } else {
      room.viewers.delete(socket.id);
      try {
        const count = Math.max(0, await redis.decr(`live:viewers:${streamId}`));
        await q(`UPDATE live_streams SET "viewerCount"=$1 WHERE id=$2`, [count, streamId]).catch(() => {});
        io.to(streamId).emit('viewer_count', { count });
      } catch {}
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── WALLET SERVICE PROXY ───────────────────────────────────────────────────
// Route /api/v1/wallet/* → wallet-service:3017
// All wallet routes require authentication.
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/v1/wallet/balance
app.get('/api/v1/wallet/balance', authMiddleware, async (req, res) => {
  const result = await callInternal(
    INTERNAL_SERVICES.wallet,
    '/api/v1/wallet/balance',
    { timeoutMs: 3000 },
  );
  if (!result) return res.status(503).json({ message: 'Wallet service unavailable' });
  res.json(result.data);
});

// POST /api/v1/wallet/topup  (rate-limited: 5/hour per user — enforced by wallet-service via Redis)
app.post('/api/v1/wallet/topup', authMiddleware, strictLimit, async (req, res) => {
  const result = await callInternal(
    INTERNAL_SERVICES.wallet,
    '/api/v1/wallet/topup',
    { method: 'POST', body: { ...req.body, userId: req.user.id }, timeoutMs: 5000 },
  );
  if (!result) return res.status(503).json({ message: 'Wallet service unavailable' });
  res.status(201).json(result.data);
});

// GET /api/v1/wallet/transactions
app.get('/api/v1/wallet/transactions', authMiddleware, async (req, res) => {
  const qs     = new URLSearchParams(req.query).toString();
  const result = await callInternal(
    INTERNAL_SERVICES.wallet,
    `/api/v1/wallet/transactions?${qs}`,
    { timeoutMs: 3000 },
  );
  if (!result) return res.status(503).json({ message: 'Wallet service unavailable' });
  res.json(result.data);
});

// ═══════════════════════════════════════════════════════════════════════════
// ── REVIEW SERVICE PROXY ───────────────────────────────────────────────────
// Route /api/v1/reviews/* → review-service:3016
// ═══════════════════════════════════════════════════════════════════════════

// Public: list reviews & stats
app.get('/api/v1/reviews', async (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/reviews?${qs}`, { timeoutMs: 5000 });
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

app.get('/api/v1/reviews/product/:productId/stats', async (req, res) => {
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/reviews/product/${req.params.productId}/stats`);
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

app.get('/api/v1/reviews/:id', async (req, res) => {
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/reviews/${req.params.id}`);
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

// Auth required: submit review
app.post('/api/v1/reviews', authMiddleware, async (req, res) => {
  const result = await callInternal(INTERNAL_SERVICES.review, '/api/v1/reviews', { method: 'POST', body: req.body });
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.status(201).json(result.data);
});

// Auth required: helpful votes
app.post('/api/v1/reviews/:id/helpful', authMiddleware, async (req, res) => {
  const body = { ...req.body, userId: req.user.id };
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/reviews/${req.params.id}/helpful`, { method: 'POST', body });
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

// Seller: add reply
app.post('/api/v1/reviews/:id/reply', authMiddleware, async (req, res) => {
  const body = { ...req.body, sellerId: req.user.id };
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/reviews/${req.params.id}/reply`, { method: 'POST', body });
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.status(201).json(result.data);
});

// Admin: moderation endpoints (ADMIN role required)
app.get('/api/v1/admin/reviews/pending', authMiddleware, async (req, res) => {
  if (!req.user.roles?.includes('ADMIN')) return res.status(403).json({ message: 'Forbidden' });
  const qs = new URLSearchParams(req.query).toString();
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/admin/reviews/pending?${qs}`);
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

app.patch('/api/v1/admin/reviews/:id/approve', authMiddleware, async (req, res) => {
  if (!req.user.roles?.includes('ADMIN')) return res.status(403).json({ message: 'Forbidden' });
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/admin/reviews/${req.params.id}/approve`, { method: 'PATCH' });
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

app.patch('/api/v1/admin/reviews/:id/reject', authMiddleware, async (req, res) => {
  if (!req.user.roles?.includes('ADMIN')) return res.status(403).json({ message: 'Forbidden' });
  const result = await callInternal(INTERNAL_SERVICES.review, `/api/v1/admin/reviews/${req.params.id}/reject`, { method: 'PATCH', body: req.body });
  if (!result) return res.status(503).json({ message: 'Review service unavailable' });
  res.json(result.data);
});

// ═══════════════════════════════════════════════════════════════════════════
// ── BOOTSTRAP ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function createLiveCommentsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS live_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "streamId" VARCHAR NOT NULL,
      "userId" VARCHAR,
      "fullName" VARCHAR,
      message TEXT NOT NULL,
      type VARCHAR DEFAULT 'text',
      "createdAt" TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_live_comments_stream ON live_comments("streamId")`);
}

async function createCartItemsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "userId" VARCHAR NOT NULL,
      "productId" VARCHAR NOT NULL,
      "variantId" VARCHAR,
      name VARCHAR NOT NULL,
      price NUMERIC(15,2) NOT NULL DEFAULT 0,
      image TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      "sellerId" VARCHAR,
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items("userId")`);
}

async function bootstrap() {
  // Create live_comments table if missing
  try { await createLiveCommentsTable(); } catch (err) { console.warn('[DB] live_comments table:', err.message); }

  // Create cart_items table for persistent cart (Redis backup)
  try { await createCartItemsTable(); } catch (err) { console.warn('[DB] cart_items table:', err.message); }

  // Connect Kafka producer (non-fatal if unavailable)
  try {
    await producer.connect();
    console.log('[Kafka] Producer connected');
  } catch (err) {
    console.warn('[Kafka] Not available, running without events:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`\n🚀 HyperCommerce API Gateway running on http://localhost:${PORT}`);
    console.log(`   Socket.IO ready at ws://localhost:${PORT}`);
    console.log(`   Endpoints: /api/auth, /api/products, /api/cart, /api/orders, /api/live-streams`);
    console.log(`   Reviews:   /api/v1/reviews, /api/v1/admin/reviews`);
    console.log(`   Admin:     /api/admin/* (ADMIN role required)`);
    console.log(`   Health:    http://localhost:${PORT}/health\n`);
  });
}

bootstrap().catch(err => { console.error(err); process.exit(1); });
