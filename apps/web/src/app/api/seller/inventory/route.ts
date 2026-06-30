import { NextRequest } from 'next/server';
import { proxyToGateway, getGatewayAuthorization } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  // Map seller inventory to products API
  const { searchParams } = new URL(req.url);
  const auth = getGatewayAuthorization(req);
  const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:4000';
  const { NextResponse } = await import('next/server');

  const url = `${GATEWAY_URL}/api/products?${searchParams.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    // Remap to seller inventory format
    const items = (data.data ?? []).map((p: Record<string, unknown>) => ({
      id: p.id,
      productName: p.name,
      sku: p.sku ?? `SKU-${String(p.id).slice(0, 8).toUpperCase()}`,
      category: p.category ?? 'Khác',
      price: p.price,
      stock: p.stock,
      image: (p.images as string[] | undefined)?.[0] ?? '',
      isLowStock: Number(p.stock) < 10,
      status: p.status,
    }));
    return NextResponse.json({ items, total: items.length });
  } catch {
    return NextResponse.json({ items: [], total: 0 });
  }
}

export async function POST(req: NextRequest) {
  return proxyToGateway(req, '/api/products');
}
