import { describe, expect, it, vi } from 'vitest';
import { safeSend } from './safe-send';

function makeWindow(
  overrides: { destroyed?: boolean; contentsDestroyed?: boolean; send?: () => void } = {},
) {
  const send = overrides.send ?? vi.fn();
  return {
    isDestroyed: vi.fn(() => overrides.destroyed ?? false),
    webContents: {
      isDestroyed: vi.fn(() => overrides.contentsDestroyed ?? false),
      send,
    },
  };
}

describe('safeSend', () => {
  it('forwards the payload when the window is live', () => {
    const window = makeWindow();

    expect(safeSend(window as never, 'notification:dismiss', { id: 'n-1' })).toBe(true);
    expect(window.webContents.send).toHaveBeenCalledWith('notification:dismiss', { id: 'n-1' });
  });

  it('skips the send when the window is destroyed', () => {
    const window = makeWindow({ destroyed: true });

    expect(safeSend(window as never, 'notification:dismiss', { id: 'n-1' })).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('skips the send when the webContents is destroyed', () => {
    const window = makeWindow({ contentsDestroyed: true });

    expect(safeSend(window as never, 'notification:dismiss', { id: 'n-1' })).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('skips the send when there is no window', () => {
    expect(safeSend(null, 'notification:dismiss', { id: 'n-1' })).toBe(false);
    expect(safeSend(undefined, 'notification:dismiss', { id: 'n-1' })).toBe(false);
  });

  // The destroyed check cannot be atomic with the send: the window can be torn
  // down in between. Swallowing that throw is the whole point of the helper —
  // it keeps a dead renderer from failing the operation that produced the event.
  it('swallows a throw from a webContents destroyed after the check', () => {
    const window = makeWindow({
      send: vi.fn(() => {
        throw new Error('Object has been destroyed');
      }),
    });

    expect(safeSend(window as never, 'notification:dismiss', { id: 'n-1' })).toBe(false);
    expect(window.webContents.send).toHaveBeenCalled();
  });
});
