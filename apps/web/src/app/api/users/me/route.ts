import { NextRequest } from 'next/server';
import { proxyToGateway, gatewayUrl } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  return proxyToGateway(req, '/api/users/me', { method: 'GET' });
}

export async function PATCH(req: NextRequest) {
  return proxyToGateway(req, '/api/users/me', { method: 'PATCH' });
}
