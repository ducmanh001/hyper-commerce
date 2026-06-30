import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToAdminService(req, `/admin/users/${params.id}/ban`, { method: 'PATCH' });
}
