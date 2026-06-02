import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToGateway(req, `/api/admin/users/${params.id}/unban`, { method: 'PATCH' });
}
