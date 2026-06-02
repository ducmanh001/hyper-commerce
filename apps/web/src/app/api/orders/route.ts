import { NextRequest } from 'next/server';
import { proxyToGateway, gatewayUrl } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  return proxyToGateway(req, gatewayUrl('/api/orders', req));
}

export async function POST(req: NextRequest) {
  return proxyToGateway(req, '/api/orders');
}
