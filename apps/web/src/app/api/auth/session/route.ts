import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, clearAuthCookieOptions } from '@/lib/server/auth';
import { getGatewayAuthorization } from '@/lib/gateway';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:4000';

export async function GET(req: NextRequest) {
  const auth = getGatewayAuthorization(req);
  if (!auth) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: auth },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const response = NextResponse.json({ user: null }, { status: 200 });
      if (res.status === 401 || res.status === 403) {
        response.cookies.set(AUTH_COOKIE.accessToken, '', clearAuthCookieOptions());
        response.cookies.set(AUTH_COOKIE.refreshToken, '', clearAuthCookieOptions());
      }
      return response;
    }

    const data = (await res.json()) as {
      id: string;
      email: string;
      fullName: string;
      avatarUrl?: string | null;
      roles?: string;
      sellerId?: string;
      points?: number;
    };

    return NextResponse.json({
      user: {
        id: data.id,
        email: data.email,
        fullName: data.fullName,
        avatar: data.avatarUrl ?? undefined,
        role: (data.roles ?? 'BUYER').split(',')[0].trim().toUpperCase(),
        sellerId: data.sellerId,
        points: data.points ?? 0,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gateway unavailable';
    return NextResponse.json({ message, user: null }, { status: 503 });
  }
}
