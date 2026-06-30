import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/server/auth';

const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';
const INTERNAL_SERVICE_TOKEN =
  process.env.INTERNAL_SERVICE_TOKEN ?? 'internal_dev_token_change_in_prod';

const ALLOWED_ADMIN_ROLES = new Set(['ADMIN', 'OPS', 'FINANCE', 'SUPER_ADMIN', 'TRUST_SAFETY']);

interface SessionPayload {
  id?: string;
  role?: string;
  email?: string;
  sub?: string;
}

function decodeSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as SessionPayload;
    return payload;
  } catch {
    return null;
  }
}

function normalizeAdminRole(role: string): string {
  const normalized = role.trim().toUpperCase();
  switch (normalized) {
    case 'SUPER_ADMIN':
      return 'super_admin';
    case 'TRUST_SAFETY':
      return 'trust_safety';
    default:
      return normalized.toLowerCase();
  }
}

function buildAdminHeaders(req: NextRequest): Record<string, string> | null {
  const accessToken = req.cookies.get(AUTH_COOKIE.accessToken)?.value;
  const payload = decodeSessionToken(accessToken);
  const role = payload?.role?.trim().toUpperCase();
  const userId = payload?.id ?? payload?.sub;

  if (!role || !ALLOWED_ADMIN_ROLES.has(role) || !userId) {
    return null;
  }

  return {
    'Content-Type': 'application/json',
    'X-Internal-Token': INTERNAL_SERVICE_TOKEN,
    'X-Admin-User-Id': userId,
    'X-Admin-User-Role': normalizeAdminRole(role),
    'X-Admin-User-Email': payload?.email ?? '',
  };
}

export async function proxyToAdminService(
  req: NextRequest,
  adminPath: string,
  options: { method?: string; body?: unknown } = {},
): Promise<NextResponse> {
  const headers = buildAdminHeaders(req);
  if (!headers) {
    return NextResponse.json({ message: 'Admin access required' }, { status: 403 });
  }

  const method = options.method ?? req.method;
  let bodyStr: string | undefined;

  if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body);
  } else if (!['GET', 'HEAD'].includes(method)) {
    try {
      bodyStr = JSON.stringify(await req.json());
    } catch {
      bodyStr = undefined;
    }
  }

  try {
    const res = await fetch(`${ADMIN_SERVICE_URL}${adminPath}`, {
      method,
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }

    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Admin service unavailable';
    return NextResponse.json({ message }, { status: 503 });
  }
}

export function adminServiceUrl(basePath: string, req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
