// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    const error = new Error('render exploded');
    error.stack = 'Error: render exploded\n    at BrokenChild';
    const boundary = new ErrorBoundary({ children: <div>Recovered UI</div> });
    boundary.setState = vi.fn((nextState) => {
      Object.assign(boundary.state, nextState);
    }) as unknown as typeof boundary.setState;
    Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(error));
    boundary.componentDidCatch(error, { componentStack: '\n    at BrokenChild' });
    const { rerender } = render(boundary.render() as ReactElement);

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
    Object.assign(boundary.state, { isCopied: true });
    rerender(boundary.render() as ReactElement);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(boundary.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null,
      componentStack: null,
    });
  });
});
