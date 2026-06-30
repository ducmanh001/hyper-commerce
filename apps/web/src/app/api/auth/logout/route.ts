import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, clearAuthCookieOptions } from '@/lib/server/auth';
import { getGatewayAuthorization } from '@/lib/gateway';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(AUTH_COOKIE.refreshToken)?.value;
  const auth = getGatewayAuthorization(req);

  try {
    await fetch(`${GATEWAY_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
  } finally {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE.accessToken, '', clearAuthCookieOptions());
    response.cookies.set(AUTH_COOKIE.refreshToken, '', clearAuthCookieOptions());
    return response;
  }
}
