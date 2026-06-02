import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  return proxyToGateway(req, `/api/admin/feature-flags/${params.key}`, { method: 'PATCH' });
}

export async function DELETE(req: NextRequest, { params }: { params: { key: string } }) {
  return proxyToGateway(req, `/api/admin/feature-flags/${params.key}`, { method: 'DELETE' });
}
