// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRendererException } from '../telemetry';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../telemetry', () => ({
  captureRendererException: vi.fn(async () => undefined),
}));

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders children before an error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Stable UI</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Stable UI')).toBeInTheDocument();
  });

  it('captures render errors, copies the trace, and dismisses the crash UI', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const error = new Error('render exploded');
    error.stack = 'Error: render exploded\n    at BrokenChild';
    const boundary = new ErrorBoundary({ children: <div>Recovered UI</div> });
    boundary.setState = vi.fn((nextState) => {
      Object.assign(boundary.state, nextState);
    }) as unknown as typeof boundary.setState;
    Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(error));
    boundary.componentDidCatch(error, { componentStack: '\n    at BrokenChild' });
    render(boundary.render() as ReactElement);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Error: render exploded/)).toBeInTheDocument();
    expect(captureRendererException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { surface: 'renderer', kind: 'react-error-boundary' },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('Error: render exploded'),
      );
    });
    // Copy feedback lives in the CopyTraceButton subcomponent's own hook state.
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(boundary.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null,
      componentStack: null,
    });
    vi.useRealTimers();
  });

  it('renders terse traces when stack or component stack details are unavailable', () => {
    const boundary = new ErrorBoundary({ children: <div /> });
    const error = new Error('terse failure');
    Object.defineProperty(error, 'stack', { configurable: true, value: undefined });
    Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(error));
    boundary.componentDidCatch(error, {});

    render(boundary.render() as ReactElement);

    expect(screen.getByText('Error: terse failure')).toBeInTheDocument();
    expect(screen.queryByText(/Component Stack/)).not.toBeInTheDocument();
    expect(captureRendererException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: { componentStack: null },
      }),
    );
  });

  it('does not duplicate a stack that only contains the error message', () => {
    const boundary = new ErrorBoundary({ children: <div /> });
    const error = new Error('message-only stack');
    error.stack = 'Error: message-only stack';
    Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(error));

    render(boundary.render() as ReactElement);

    expect(screen.getByText('Error: message-only stack')).toBeInTheDocument();
  });

  it('omits the trace block if an invalid error state has no error object', () => {
    const boundary = new ErrorBoundary({ children: <div /> });
    Object.assign(boundary.state, { hasError: true, error: null });

    render(boundary.render() as ReactElement);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('reloads the window from the crash UI', () => {
    const error = new Error('reload me');
    const boundary = new ErrorBoundary({ children: <div /> });
    Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(error));
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(boundary.render() as ReactElement);
    fireEvent.click(screen.getByRole('button', { name: 'Reload App' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
