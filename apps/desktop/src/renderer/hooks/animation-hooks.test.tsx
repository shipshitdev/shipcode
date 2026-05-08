// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedNumber } from './useAnimatedNumber';
import { useDelayedUnmount } from './useDelayedUnmount';

function DelayedUnmountHarness({ visible, delayMs }: { visible: boolean; delayMs: number }) {
  const state = useDelayedUnmount(visible, delayMs);

  return (
    <div>
      <span data-testid="should-render">{String(state.shouldRender)}</span>
      <span data-testid="is-exiting">{String(state.isExiting)}</span>
    </div>
  );
}

function AnimatedNumberHarness({ target, duration }: { target: number; duration?: number }) {
  const value = useAnimatedNumber(target, duration);

  return <span data-testid="value">{value}</span>;
}

describe('animation hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps delayed content mounted while the exit timer runs', () => {
    const { rerender } = render(<DelayedUnmountHarness visible={true} delayMs={250} />);

    expect(screen.getByTestId('should-render')).toHaveTextContent('true');
    expect(screen.getByTestId('is-exiting')).toHaveTextContent('false');

    rerender(<DelayedUnmountHarness visible={false} delayMs={250} />);

    expect(screen.getByTestId('should-render')).toHaveTextContent('true');
    expect(screen.getByTestId('is-exiting')).toHaveTextContent('true');

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByTestId('should-render')).toHaveTextContent('false');
    expect(screen.getByTestId('is-exiting')).toHaveTextContent('false');
  });

  it('cancels a delayed unmount when content becomes visible again', () => {
    const { rerender } = render(<DelayedUnmountHarness visible={true} delayMs={250} />);

    rerender(<DelayedUnmountHarness visible={false} delayMs={250} />);
    rerender(<DelayedUnmountHarness visible={true} delayMs={250} />);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByTestId('should-render')).toHaveTextContent('true');
    expect(screen.getByTestId('is-exiting')).toHaveTextContent('false');
  });

  it('uses the target immediately when reduced motion is enabled', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    const { rerender } = render(<AnimatedNumberHarness target={1} />);
    expect(screen.getByTestId('value')).toHaveTextContent('1');

    rerender(<AnimatedNumberHarness target={25} />);

    expect(screen.getByTestId('value')).toHaveTextContent('25');
  });

  it('animates toward the target and cancels pending frames on unmount', () => {
    let frameCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 42;
    });
    const cancelAnimationFrameMock = vi.fn();

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    const { rerender, unmount } = render(<AnimatedNumberHarness target={0} duration={100} />);
    rerender(<AnimatedNumberHarness target={10} duration={100} />);

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    act(() => {
      frameCallback?.(0);
    });
    expect(screen.getByTestId('value')).toHaveTextContent('0');

    act(() => {
      frameCallback?.(100);
    });
    expect(screen.getByTestId('value')).toHaveTextContent('10');

    rerender(<AnimatedNumberHarness target={20} duration={100} />);
    unmount();

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(42);
  });
});
