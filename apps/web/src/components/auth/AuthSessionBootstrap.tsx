'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/lib/store/auth';

export function AuthSessionBootstrap() {
  const syncSession = useAuthStore((state) => state.syncSession);
  const setHydrated = useAuthStore((state) => state.setHydrated);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const body = (await res.json().catch(() => ({ user: null }))) as {
          user?: Parameters<typeof syncSession>[0];
        };

        if (!cancelled) {
          syncSession(body.user ?? null);
        }
      } catch {
        if (!cancelled) {
          syncSession(null);
        }
      } finally {
        if (!cancelled) {
          setHydrated();
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [setHydrated, syncSession]);

  return null;
}
