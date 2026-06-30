import { NextRequest } from 'next/server';
import { adminServiceUrl, proxyToAdminService } from '@/lib/admin-proxy';

export async function GET(req: NextRequest) {
  return proxyToAdminService(req, adminServiceUrl('/admin/disputes/stats', req), {
    method: 'GET',
  });
}
