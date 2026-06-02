import { NextRequest } from 'next/server';
import { proxyToGateway, gatewayUrl } from '@/lib/gateway';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToGateway(req, `/api/orders/${params.id}`, { method: 'GET' });
}
