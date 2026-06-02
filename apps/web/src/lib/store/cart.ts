// =====================================================
// Cart store — Zustand
// WHY ZUSTAND (not Redux/Context)?
// - 0 boilerplate: no reducers, action creators, dispatchers
// - ~1KB gzipped (Redux Toolkit: ~12KB)
// - Works with React 18 concurrent features out of box
// - Persists to localStorage automatically with persist middleware
//
// Architecture:
// - Optimistic local update first (fast UX)
// - Backend sync (Redis + DB) when authenticated
// - localStorage fallback for guest users / offline
// =====================================================

'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { CartItem, Product } from '@/types';
import { clientApi } from '@/lib/api-client';

interface CartState {
  items: CartItem[];
  isLoading: boolean;
  error: string | null;
  voucherCode: string | null;
  voucherDiscount: number;
  shippingFee: number;

  // Actions
  addItem: (product: Product, variantId: string | undefined, quantity: number) => Promise<void>;
  removeItem: (productId: string, variantId?: string) => void;
  updateQuantity: (productId: string, variantId: string | undefined, quantity: number) => void;
  applyVoucher: (code: string) => Promise<void>;
  clearVoucher: () => void;
  clearCart: () => void;
  /** Load cart from server (call on login / app init when authenticated) */
  syncFromServer: () => Promise<void>;

  // Computed helpers (not persisted)
  getItemCount: () => number;
  getSubtotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      error: null,
      voucherCode: null,
      voucherDiscount: 0,
      shippingFee: 30_000,

      getItemCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
      getSubtotal: () => get().items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),

      addItem: async (product, variantId, quantity) => {
        set({ isLoading: true, error: null });

        // 1. Optimistic local update
        const existingIdx = get().items.findIndex(
          (i) => i.productId === product.id && i.variantId === variantId,
        );
        const effectivePrice = product.salePrice ?? product.price;

        if (existingIdx >= 0) {
          const items = [...get().items];
          items[existingIdx] = { ...items[existingIdx], quantity: items[existingIdx].quantity + quantity };
          set({ items, isLoading: false });
        } else {
          const newItem: CartItem = {
            productId: product.id,
            variantId,
            quantity,
            unitPrice: effectivePrice,
            product: {
              id: product.id,
              name: product.name,
              thumbnailUrl: product.thumbnailUrl,
              sellerId: product.sellerId,
              sellerName: product.sellerName,
            },
          };
          set({ items: [...get().items, newItem], isLoading: false });
        }

        // 2. Sync to backend — update local state with authoritative server response
        try {
          const serverCart = await clientApi.addToCart(product.id, variantId, quantity);
          if (serverCart?.items?.length) {
            const merged = serverCart.items.map((si) => ({
              productId: si.productId,
              variantId: si.variantId,
              quantity: si.quantity,
              unitPrice: (si as CartItem & { price?: number }).unitPrice ?? (si as CartItem & { price?: number }).price ?? effectivePrice,
              product: si.product ?? {
                id: si.productId,
                name: (si as CartItem & { name?: string }).name ?? product.name,
                thumbnailUrl: product.thumbnailUrl,
                sellerId: product.sellerId,
                sellerName: product.sellerName,
              },
            }));
            set({ items: merged, shippingFee: serverCart.shippingFee ?? get().shippingFee });
          }
        } catch {
          // Server unavailable — localStorage version is fine as fallback
        }
      },

      removeItem: (productId, variantId) => {
        // Optimistic local remove
        set({ items: get().items.filter((i) => !(i.productId === productId && i.variantId === variantId)) });
        // Backend sync (non-blocking)
        clientApi.removeFromCart(productId, variantId).then((serverCart) => {
          if (serverCart?.items) {
            set({ items: serverCart.items, shippingFee: serverCart.shippingFee ?? get().shippingFee });
          }
        }).catch(() => { /* localStorage is fine */ });
      },

      updateQuantity: (productId, variantId, quantity) => {
        if (quantity <= 0) { get().removeItem(productId, variantId); return; }
        set({
          items: get().items.map((i) =>
            i.productId === productId && i.variantId === variantId ? { ...i, quantity } : i,
          ),
        });
      },

      applyVoucher: async (code) => {
        set({ isLoading: true, error: null });
        try {
          const result = await clientApi.applyVoucher(code);
          const subtotal = get().getSubtotal();
          const discount = result.type === 'PERCENT'
            ? Math.round(subtotal * result.discount)
            : result.discount;
          set({ voucherCode: result.code, voucherDiscount: discount, isLoading: false });
        } catch (e) {
          set({ isLoading: false, error: (e as Error).message ?? 'Invalid voucher' });
        }
      },

      clearVoucher: () => set({ voucherCode: null, voucherDiscount: 0 }),

      clearCart: () => {
        set({ items: [], voucherCode: null, voucherDiscount: 0, shippingFee: 30_000 });
        // Clear server cart non-blocking
        fetch('/api/cart', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      },

      syncFromServer: async () => {
        try {
          const serverCart = await clientApi.getCart();
          if (!serverCart?.items) return;
          // Merge: server is authoritative when items exist
          if (serverCart.items.length > 0) {
            const merged = serverCart.items.map((si) => ({
              productId: si.productId,
              variantId: si.variantId,
              quantity: si.quantity,
              unitPrice: (si as CartItem & { price?: number }).unitPrice ?? (si as CartItem & { price?: number }).price ?? 0,
              product: si.product ?? {
                id: si.productId,
                name: (si as CartItem & { name?: string }).name ?? 'Product',
                thumbnailUrl: undefined,
                sellerId: (si as CartItem & { sellerId?: string }).sellerId,
                sellerName: undefined,
              },
            }));
            set({ items: merged, shippingFee: serverCart.shippingFee ?? 30_000 });
          } else if (get().items.length > 0) {
            // Server cart empty but local has items — push local to server
            for (const item of get().items) {
              await clientApi.addToCart(item.productId, item.variantId, item.quantity).catch(() => {});
            }
          }
        } catch { /* non-fatal */ }
      },
    }),
    {
      name: 'hc-cart',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => void 0, removeItem: () => void 0 },
      ),
      partialize: (state) => ({
        items: state.items,
        voucherCode: state.voucherCode,
        voucherDiscount: state.voucherDiscount,
      }),
    },
  ),
);
