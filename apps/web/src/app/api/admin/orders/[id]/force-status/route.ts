import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToGateway(req, `/api/admin/orders/${params.id}/force-status`, { method: 'PATCH' });
}

export { POST as PATCH };
