// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedSecondNow } from './useSharedSecondNow';

function ClockHarness({ label }: { label: string }) {
  const now = useSharedSecondNow();

  return <span data-testid={label}>{now}</span>;
}

describe('useSharedSecondNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T10:00:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shares one ticking second clock across subscribers and stops after unmount', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    const first = render(<ClockHarness label="first" />);
    const second = render(<ClockHarness label="second" />);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('first').textContent).toBe(screen.getByTestId('second').textContent);

    vi.setSystemTime(new Date('2026-05-08T10:00:01.000Z'));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId('first').textContent).toBe(String(Date.now()));
    expect(screen.getByTestId('second').textContent).toBe(String(Date.now()));

    first.unmount();
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    second.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
