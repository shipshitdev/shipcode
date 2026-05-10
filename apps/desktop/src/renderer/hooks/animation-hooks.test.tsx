// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedNumber } from './useAnimatedNumber';

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

  it('cancels an in-flight animation before starting a new target animation', () => {
    let frameCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return requestAnimationFrameMock.mock.calls.length;
    });
    const cancelAnimationFrameMock = vi.fn();

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    const { rerender } = render(<AnimatedNumberHarness target={0} duration={100} />);
    rerender(<AnimatedNumberHarness target={10} duration={100} />);

    act(() => {
      frameCallback?.(50);
    });
    rerender(<AnimatedNumberHarness target={20} duration={100} />);

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(2);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(3);
  });
});
