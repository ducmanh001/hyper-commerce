import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function PATCH(req: NextRequest) {
  return proxyToGateway(req, '/api/notifications/read-all', { method: 'PATCH' });
}
