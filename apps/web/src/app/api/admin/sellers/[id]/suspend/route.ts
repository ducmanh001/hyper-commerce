import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToAdminService(req, `/admin/sellers/${params.id}/suspend`, { method: 'PATCH' });
}

export { POST as PATCH };
