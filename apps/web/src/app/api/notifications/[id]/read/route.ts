import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToGateway(req, `/api/notifications/${params.id}/read`, { method: 'PATCH' });
}
