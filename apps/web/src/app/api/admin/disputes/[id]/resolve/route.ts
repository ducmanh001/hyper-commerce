import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyToAdminService(req, `/admin/disputes/${params.id}/resolve`);
}
