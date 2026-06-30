import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function GET(req: NextRequest) {
  return proxyToAdminService(req, '/admin/system/service-health', { method: 'GET' });
}
