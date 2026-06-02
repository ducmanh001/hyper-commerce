import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  return proxyToGateway(req, '/api/admin/feature-flags', { method: 'GET' });
}

export async function POST(req: NextRequest) {
  return proxyToGateway(req, '/api/admin/feature-flags');
}
