import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function POST(req: NextRequest) {
  return proxyToGateway(req, '/api/cart/items');
}

export async function DELETE(req: NextRequest) {
  return proxyToGateway(req, '/api/cart/items', { method: 'DELETE' });
}
