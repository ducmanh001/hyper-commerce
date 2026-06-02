'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Product } from '@/types';

interface WishlistState {
  items: Product[];
  addItem:    (product: Product) => void;
  removeItem: (id: string) => void;
  toggle:     (product: Product) => void;
  hasItem:    (id: string) => boolean;
  clear:      () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product) =>
        set((state) => ({
          items: state.items.some((i) => i.id === product.id)
            ? state.items
            : [...state.items, product],
        })),

      removeItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

      toggle: (product) => {
        if (get().hasItem(product.id)) get().removeItem(product.id);
        else get().addItem(product);
      },

      hasItem: (id) => get().items.some((i) => i.id === id),

      clear: () => set({ items: [] }),
    }),
    {
      name:    'hc-wishlist',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => void 0, removeItem: () => void 0 },
      ),
    },
  ),
);
