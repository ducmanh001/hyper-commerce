import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway';

export async function POST(req: NextRequest) {
  return proxyToGateway(req, '/api/auth/register');
}
