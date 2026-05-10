// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedSecondNow } from './second-ticker';

function ClockHarness({ label }: { label: string }) {
  const now = useSharedSecondNow();
  return <span data-testid={label}>{now}</span>;
}

function renderIntoDom(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    rerender: (next: React.ReactNode) => {
      act(() => {
        root.render(next);
      });
    },
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('useSharedSecondNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one ticking clock across subscribers and stops after the last unsubscribe', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    const first = renderIntoDom(<ClockHarness label="first" />);
    const second = renderIntoDom(<ClockHarness label="second" />);

    const getText = (view: { container: HTMLElement }, id: string) =>
      view.container.querySelector(`[data-testid="${id}"]`)?.textContent;

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(getText(first, 'first')).toBe(String(Date.now()));
    expect(getText(second, 'second')).toBe(String(Date.now()));

    vi.setSystemTime(new Date('2026-05-08T10:00:01.000Z'));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(getText(first, 'first')).toBe(String(Date.now()));
    expect(getText(second, 'second')).toBe(String(Date.now()));

    first.cleanup();
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    second.cleanup();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('keeps the current snapshot on rerender while the shared interval is active', () => {
    const view = renderIntoDom(<ClockHarness label="active" />);
    const firstValue = view.container.querySelector('[data-testid="active"]')?.textContent;

    vi.setSystemTime(new Date('2026-05-08T10:00:00.500Z'));
    act(() => {
      view.rerender(<ClockHarness label="active" />);
    });

    expect(view.container.querySelector('[data-testid="active"]')?.textContent).toBe(firstValue);

    view.cleanup();
  });

  it('uses the server snapshot during server rendering', () => {
    expect(renderToString(<ClockHarness label="server" />)).toContain('>0</span>');
  });
});
