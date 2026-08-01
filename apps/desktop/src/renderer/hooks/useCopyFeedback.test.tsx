// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type UseCopyFeedbackOptions, useCopyFeedback } from './useCopyFeedback';

function CopyHarness({
  options,
  text = 'branch-name',
  copyKey,
}: {
  options?: UseCopyFeedbackOptions;
  text?: string;
  copyKey?: string;
}) {
  const { status, copied, copiedKey, isCopied, copy, flash } = useCopyFeedback(options);
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="copied">{String(copied)}</span>
      <span data-testid="copied-key">{copiedKey ?? 'none'}</span>
      <span data-testid="is-copied-row">{String(isCopied('row-1'))}</span>
      <button type="button" onClick={() => void copy(text, copyKey)}>
        Copy
      </button>
      <button type="button" onClick={() => flash(copyKey)}>
        Flash
      </button>
    </>
  );
}

describe('useCopyFeedback', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    // Restore the timer spies before uninstalling the fake clock: the spies were installed
    // over the fake functions, so restoring them afterwards would reinstate the fake ones.
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clears the pending reset timer when the component unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    const { unmount } = render(<CopyHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('copied');
    });

    // Identify the hook's own reset timer by its delay — waitFor schedules timers too.
    const resetTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 1500);
    expect(resetTimerIndex).toBeGreaterThanOrEqual(0);
    const resetTimerId = setTimeoutSpy.mock.results[resetTimerIndex]?.value;
    expect(clearTimeoutSpy).not.toHaveBeenCalledWith(resetTimerId);

    unmount();

    // The timer is cleared by the unmount cleanup, not left to fire into a dead component.
    expect(clearTimeoutSpy).toHaveBeenCalledWith(resetTimerId);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
  });

  it('resets to idle after the default duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CopyHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(screen.getByTestId('copied')).toHaveTextContent('true');
    });
    expect(writeText).toHaveBeenCalledWith('branch-name');

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByTestId('copied')).toHaveTextContent('false');
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('honours a custom reset duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CopyHarness options={{ resetMs: 2000 }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(screen.getByTestId('copied')).toHaveTextContent('true');
    });

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('copied')).toHaveTextContent('true');

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('copied')).toHaveTextContent('false');
  });

  it('clears the previous timer when copying again before it fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    render(<CopyHarness />);

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(screen.getByTestId('copied')).toHaveTextContent('true');
    });

    clearTimeoutSpy.mockClear();
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledTimes(2);
    });
  });

  it('reports an error status and drops the key when the clipboard write fails', async () => {
    writeText.mockRejectedValue(new Error('blocked'));
    render(<CopyHarness copyKey="row-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(screen.getByTestId('copied')).toHaveTextContent('false');
    expect(screen.getByTestId('copied-key')).toHaveTextContent('none');
    expect(screen.getByTestId('is-copied-row')).toHaveTextContent('false');
  });

  it('tracks the copied key so only the matching row shows feedback', async () => {
    render(<CopyHarness copyKey="row-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(screen.getByTestId('is-copied-row')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('copied-key')).toHaveTextContent('row-1');
  });

  it('flashes feedback without touching the clipboard', async () => {
    render(<CopyHarness copyKey="row-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Flash' }));

    await waitFor(() => {
      expect(screen.getByTestId('is-copied-row')).toHaveTextContent('true');
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});
