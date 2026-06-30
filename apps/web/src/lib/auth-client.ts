import { useAuthStore } from '@/lib/store/auth';

export async function logoutUser() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // Best effort — local state still needs clearing.
  } finally {
    useAuthStore.getState().clearAuth();
  }
}
