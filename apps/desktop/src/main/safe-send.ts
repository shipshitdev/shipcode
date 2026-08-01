import type { IpcStreamChannel, IpcStreamChannels } from '@shipcode/shared';
import type { BrowserWindow } from 'electron';

/**
 * Whether a renderer is still around to receive events.
 *
 * `safeSend` applies this itself, so a plain send never needs it. Use it only to
 * skip work that exists purely to build a payload — a database read, a git call —
 * that would otherwise run for a renderer that is already gone.
 */
export function canSendToRenderer(
  window: BrowserWindow | null | undefined,
): window is BrowserWindow {
  return !!window && !window.isDestroyed() && !window.webContents.isDestroyed();
}

/**
 * The single guarded path from the main process to the renderer.
 *
 * Every `webContents.send` in the main process must go through here. A raw send
 * throws once the window (or its webContents) is destroyed, and that throw
 * escapes the IPC handler that produced it — so a GitHub write that already
 * succeeded gets reported to the caller as a failure while the remote state has
 * in fact changed. A renderer notification is best-effort by nature: if nobody
 * is listening any more, dropping it is the correct outcome, never an error.
 *
 * Both the destroyed check and the try/catch are required. The check covers the
 * common case; the catch covers the race where the window is torn down between
 * the check and the send, and the disposed render frame that dev-mode HMR
 * leaves behind.
 *
 * @returns whether the payload was handed to the renderer.
 */
export function safeSend<C extends IpcStreamChannel>(
  window: BrowserWindow | null | undefined,
  channel: C,
  payload: IpcStreamChannels[C],
): boolean;
export function safeSend(
  window: BrowserWindow | null | undefined,
  channel: string,
  payload?: unknown,
): boolean;
export function safeSend(
  window: BrowserWindow | null | undefined,
  channel: string,
  payload?: unknown,
): boolean {
  if (!canSendToRenderer(window)) return false;
  try {
    window.webContents.send(channel, payload);
    return true;
  } catch {
    /* window torn down between the check and the send, or frame disposed by HMR */
    return false;
  }
}
