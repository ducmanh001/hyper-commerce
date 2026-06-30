import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/server/auth';

export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get(AUTH_COOKIE.accessToken)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ accessToken });
}
