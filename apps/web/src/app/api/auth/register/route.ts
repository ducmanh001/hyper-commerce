import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authCookieOptions } from '@/lib/server/auth';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const ACCESS_TTL_SECONDS = 24 * 60 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  const body = await req.text();

  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    let data: Record<string, unknown>;

    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { message: text };
    }

    const response = NextResponse.json(data, { status: res.status });

    if (res.ok && typeof data.accessToken === 'string' && typeof data.refreshToken === 'string') {
      response.cookies.set(
        AUTH_COOKIE.accessToken,
        data.accessToken,
        authCookieOptions(ACCESS_TTL_SECONDS),
      );
      response.cookies.set(
        AUTH_COOKIE.refreshToken,
        data.refreshToken,
        authCookieOptions(REFRESH_TTL_SECONDS),
      );
    }

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gateway unavailable';
    return NextResponse.json({ message: `API Gateway error: ${message}` }, { status: 503 });
  }
}
