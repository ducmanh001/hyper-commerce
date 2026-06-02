import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  return proxyToGateway(req, '/api/cart', { method: 'GET' });
}

export async function DELETE(req: NextRequest) {
  return proxyToGateway(req, '/api/cart', { method: 'DELETE' });
}
