/**
 * Gateway proxy utility for Next.js API routes.
 * All BFF routes call this to forward requests to the API Gateway.
 *
 * Architecture: Browser → Next.js BFF → API Gateway → PostgreSQL / Redis / Kafka
 */

import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:4000';

export async function proxyToGateway(
  req: NextRequest,
  gatewayPath: string,
  options: { method?: string; body?: unknown } = {},
): Promise<NextResponse> {
  const method = options.method ?? req.method;
  const url = `${GATEWAY_URL}${gatewayPath}`;

  // Forward Authorization header from the browser request
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const auth = req.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body);
  } else if (!['GET', 'HEAD'].includes(method)) {
    try { bodyStr = JSON.stringify(await req.json()); } catch { /* no body */ }
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { message: text }; }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gateway unavailable';
    return NextResponse.json({ message: `API Gateway error: ${msg}` }, { status: 503 });
  }
}

/** Build gateway URL with query params from Next.js request */
export function gatewayUrl(basePath: string, req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
