import { NextRequest } from 'next/server';
import { proxyToAdminService } from '@/lib/admin-proxy';

export async function GET(req: NextRequest) {
  return proxyToAdminService(req, '/admin/feature-flags', { method: 'GET' });
}

export async function POST(req: NextRequest) {
  return proxyToAdminService(req, '/admin/feature-flags');
}
