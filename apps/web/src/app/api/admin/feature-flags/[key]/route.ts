import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  return proxyToAdminService(req, `/admin/feature-flags/${params.key}`, { method: 'PATCH' });
}

export async function DELETE(req: NextRequest, { params }: { params: { key: string } }) {
  return proxyToAdminService(req, `/admin/feature-flags/${params.key}`, { method: 'DELETE' });
}
