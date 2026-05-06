import { create } from 'zustand';

export type ToastKind = 'error' | 'success' | 'info';

export interface ToastRecord {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
}

let _counter = 0;

interface ToastStore {
  toasts: ToastRecord[];
  addToast: (toast: Omit<ToastRecord, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++_counter}-${Date.now()}`;
    set((s) => ({ toasts: [{ ...toast, id }, ...s.toasts].slice(0, 5) }));
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const TOAST_KIND_TONE = {
  error: 'danger',
  success: 'success',
  info: 'default',
} as const;

export const toastTone = (kind: ToastKind) => TOAST_KIND_TONE[kind];

export const toast = {
  error: (title: string, body?: string) =>
    useToastStore.getState().addToast({ kind: 'error', title, body }),
  success: (title: string, body?: string) =>
    useToastStore.getState().addToast({ kind: 'success', title, body }),
  info: (title: string, body?: string) =>
    useToastStore.getState().addToast({ kind: 'info', title, body }),
};
