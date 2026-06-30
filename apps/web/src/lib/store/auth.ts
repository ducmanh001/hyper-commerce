/**
 * Auth Zustand store — persisted to localStorage.
 * Uses zustand/middleware persist for hydration-safe SSR.
 */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatar?: string;
  role: string;
  sellerId?: string;
  points: number;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isHydrated: boolean;
  // Actions
  setAuth: (user: AuthUser, accessToken?: string | null, refreshToken?: string | null) => void;
  syncSession: (user: AuthUser | null) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearAuth: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isHydrated: false,

      setAuth: (user, accessToken = null, refreshToken = null) =>
        set({ user, accessToken, refreshToken }),

      syncSession: (user) =>
        set((state) => ({
          user,
          accessToken: user ? state.accessToken : null,
          refreshToken: user ? state.refreshToken : null,
        })),

      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),

      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),

      setHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: 'hc-auth',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => void 0, removeItem: () => void 0 },
      ),
      partialize: (state) => ({
        user: state.user,
      }),
    },
  ),
);

/** Selector helper — avoids unnecessary re-renders */
export const useCurrentUser = () => useAuthStore((s) => s.user);
export const useIsAuthenticated = () => useAuthStore((s) => !!s.accessToken);
