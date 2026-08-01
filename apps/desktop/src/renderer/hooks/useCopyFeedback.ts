import { useCallback, useEffect, useRef, useState } from 'react';

export const DEFAULT_COPY_FEEDBACK_MS = 1500;

export type CopyFeedbackStatus = 'idle' | 'copied' | 'error';

type CopyFeedbackState = { status: CopyFeedbackStatus; key: string | null };

const IDLE_STATE: CopyFeedbackState = { status: 'idle', key: null };

export interface UseCopyFeedbackOptions {
  /** How long the feedback stays visible before it resets to idle. */
  resetMs?: number;
}

export interface UseCopyFeedbackResult {
  /** Tri-state, for call sites that surface a distinct clipboard-failure affordance. */
  status: CopyFeedbackStatus;
  /** True while the last copy is still showing feedback — for single-target buttons. */
  copied: boolean;
  /** Key of the last successful copy, or null — for lists that plumb the key through props. */
  copiedKey: string | null;
  /** Keyed check, for lists where only one row shows feedback at a time. */
  isCopied: (key: string) => boolean;
  /** Writes to the clipboard and flashes feedback. Resolves true when the write succeeded. */
  copy: (text: string, key?: string) => Promise<boolean>;
  /** Flashes the same feedback for confirmations that do not touch the clipboard. */
  flash: (key?: string) => void;
}

/**
 * Transient "Copied!" feedback with a ref-held reset timer that is cleared on unmount.
 *
 * Without the cleanup the timer outlives the view: it fires after unmount and sets state
 * on a component that is no longer mounted.
 */
export function useCopyFeedback(options: UseCopyFeedbackOptions = {}): UseCopyFeedbackResult {
  const { resetMs = DEFAULT_COPY_FEEDBACK_MS } = options;
  const [state, setState] = useState<CopyFeedbackState>(IDLE_STATE);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingReset = useCallback(() => {
    const timeout = resetTimeoutRef.current;
    if (timeout) clearTimeout(timeout);
    resetTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearPendingReset();
    };
  }, [clearPendingReset]);

  const show = useCallback(
    (next: CopyFeedbackState) => {
      clearPendingReset();
      setState(next);
      resetTimeoutRef.current = setTimeout(() => {
        resetTimeoutRef.current = null;
        setState(IDLE_STATE);
      }, resetMs);
    },
    [clearPendingReset, resetMs],
  );

  const copy = useCallback(
    async (text: string, key?: string) => {
      try {
        await navigator.clipboard.writeText(text);
        show({ status: 'copied', key: key ?? null });
        return true;
      } catch {
        show({ status: 'error', key: null });
        return false;
      }
    },
    [show],
  );

  const flash = useCallback(
    (key?: string) => {
      show({ status: 'copied', key: key ?? null });
    },
    [show],
  );

  const isCopied = useCallback(
    (key: string) => state.status === 'copied' && state.key === key,
    [state],
  );

  return {
    status: state.status,
    copied: state.status === 'copied',
    copiedKey: state.status === 'copied' ? state.key : null,
    isCopied,
    copy,
    flash,
  };
}
