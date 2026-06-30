// =====================================================
// API Client — typed wrapper around fetch for BFF routes
// WHY NOT AXIOS? Next.js Server Components use native fetch
// with built-in caching. Using axios in RSC requires extra
// config. We use fetch directly, axios only in Client Components.
//
// Auth model:
// - Browser calls same-origin `/api/*` BFF routes
// - BFF reads httpOnly auth cookies and forwards auth to gateway
// - Client code should not rely on localStorage tokens
// =====================================================

import { ApiError, SearchResult, Product, Order, Cart, CartItem } from '@/types';

const INTERNAL_BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000';
// All service calls go through the API Gateway

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  return headers;
}

// ── Server-side fetchers (used in RSC/generateStaticParams) ──

export async function searchProducts(params: {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  pageSize?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'popular';
}): Promise<SearchResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.minPrice != null) qs.set('minPrice', String(params.minPrice));
  if (params.maxPrice != null) qs.set('maxPrice', String(params.maxPrice));
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 24));
  if (params.sort) qs.set('sort', params.sort);

  const res = await fetch(`${INTERNAL_BASE}/api/search?${qs.toString()}`, {
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`search failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<SearchResult>;
}

export async function getProduct(id: string): Promise<Product> {
  const res = await fetch(`${INTERNAL_BASE}/api/products/${id}`, { next: { revalidate: 60 } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`getProduct failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<Product>;
}

export async function getFlashSaleProducts(): Promise<Product[]> {
  const res = await fetch(`${INTERNAL_BASE}/api/products/flash-sale`, { next: { revalidate: 10 } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`getFlashSaleProducts failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { products: Product[] };
  return data.products ?? [];
}

export async function getFeaturedProducts(): Promise<Product[]> {
  const res = await fetch(`${INTERNAL_BASE}/api/products/featured`, { next: { revalidate: 300 } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`getFeaturedProducts failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { products: Product[] };
  return data.products ?? [];
}

// ── Client-side API (called from 'use client' components) ──
// These go through Next.js API routes (BFF), never directly to services

export const clientApi = {
  // Auth
  async login(email: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = (await res.json()) as ApiError;
      throw new Error(err.message);
    }
    return res.json();
  },

  // Cart
  async getCart(): Promise<Cart> {
    const res = await fetch('/api/cart', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load cart');
    return res.json() as Promise<Cart>;
  },

  async addToCart(
    productId: string,
    variantId: string | undefined,
    quantity: number,
    adImpressionId?: string,
  ) {
    const res = await fetch('/api/cart/items', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ productId, variantId, quantity, adImpressionId }),
    });
    if (!res.ok) {
      const err = (await res.json()) as ApiError;
      throw new Error(err.message);
    }
    return res.json() as Promise<Cart>;
  },

  async removeFromCart(productId: string, variantId?: string) {
    const res = await fetch('/api/cart/items', {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ productId, variantId }),
    });
    if (!res.ok) throw new Error('Failed to remove item');
    return res.json() as Promise<Cart>;
  },

  async applyVoucher(code: string) {
    const res = await fetch('/api/cart/voucher', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const err = (await res.json()) as ApiError;
      throw new Error(err.message);
    }
    return res.json() as Promise<{ code: string; discount: number; type: 'PERCENT' | 'FIXED' }>;
  },

  // Orders
  async createOrder(orderData: {
    items: CartItem[];
    shippingAddress: Record<string, string>;
    paymentMethod: string;
    voucherCode?: string;
    shippingMethod: string;
  }): Promise<Order> {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(orderData),
    });
    if (!res.ok) {
      const err = (await res.json()) as ApiError;
      throw new Error(err.message);
    }
    return res.json() as Promise<Order>;
  },

  async getMyOrders(page = 1): Promise<{ orders: Order[]; total: number }> {
    const res = await fetch(`/api/orders/my?page=${page}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load orders');
    return res.json();
  },

  async getOrder(id: string): Promise<Order> {
    const res = await fetch(`/api/orders/${id}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Order ${id} not found`);
    return res.json() as Promise<Order>;
  },

  // Ad click tracking — fire and forget, never await
  trackAdClick(impressionId: string, productId: string) {
    // Use sendBeacon so click is tracked even if user navigates away immediately
    const data = JSON.stringify({ impressionId, productId, ts: Date.now() });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/ads/click', data);
    }
  },
};
