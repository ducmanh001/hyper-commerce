import { NextRequest } from 'next/server';
import { proxyToGateway, gatewayUrl } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  return proxyToGateway(req, gatewayUrl('/api/seller/ads', req));
}

export async function POST(req: NextRequest) {
  return proxyToGateway(req, '/api/seller/ads');
}
