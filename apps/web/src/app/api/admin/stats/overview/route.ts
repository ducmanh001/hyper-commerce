import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function GET(req: NextRequest) {
  return proxyToAdminService(req, '/admin/dashboard/summary', { method: 'GET' });
}
