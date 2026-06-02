import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToGateway(req, `/api/seller/ads/${params.id}/activate`, { method: 'PATCH' });
}
