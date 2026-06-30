export const AUTH_COOKIE = {
  accessToken: 'hc_access_token',
  refreshToken: 'hc_refresh_token',
} as const;

export function isValidBearerHeader(value: string | null | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('bearer ') &&
    normalized !== 'bearer null' &&
    normalized !== 'bearer undefined' &&
    normalized !== 'bearer'
  );
}

export function authCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function clearAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
}
