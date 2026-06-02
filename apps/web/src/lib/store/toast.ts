'use client';

import { create } from 'zustand';

export interface Toast {
  id:       string;
  type:     'success' | 'error' | 'info' | 'warning';
  title:    string;
  message?: string;
  duration: number;
}

interface ToastState {
  toasts:  Toast[];
  add:     (toast: Omit<Toast, 'id'>) => string;
  remove:  (id: string) => void;
  success: (title: string, message?: string) => void;
  error:   (title: string, message?: string) => void;
  info:    (title: string, message?: string) => void;
}

let _counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  add: (toast) => {
    const id = `toast-${++_counter}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (toast.duration > 0) {
      setTimeout(() => get().remove(id), toast.duration);
    }
    return id;
  },

  remove: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  success: (title, message) =>
    get().add({ type: 'success', title, message, duration: 4000 }),

  error: (title, message) =>
    get().add({ type: 'error', title, message, duration: 6000 }),

  info: (title, message) =>
    get().add({ type: 'info', title, message, duration: 4000 }),
}));

export const useToast = () => {
  const store = useToastStore();
  return {
    success: store.success,
    error:   store.error,
    info:    store.info,
    remove:  store.remove,
  };
};
