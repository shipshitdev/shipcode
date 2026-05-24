// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { UpdateStatus } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';

function makeStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    hasUpdate: true,
    current: '0.1.0',
    latest: '0.2.0',
    releaseTag: 'v0.2.0',
    releaseUrl: 'https://github.com/shipshitdev/shipcode/releases/tag/v0.2.0',
    publishedAt: '2026-05-08T09:00:00.000Z',
    checkedAt: '2026-05-08T10:00:00.000Z',
    state: 'available',
    error: null,
    ...overrides,
  };
}

function renderBanner() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <UpdateBanner />
    </QueryClientProvider>,
  );
}

describe('UpdateBanner', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  let statusListener: ((status: UpdateStatus) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    statusListener = null;
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn((channel, listener) => {
      if (channel === 'update:status-changed') {
        statusListener = listener as (status: UpdateStatus) => void;
      }
      return () => {};
    }) as unknown as typeof window.shipcode.on;
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
  });

  it('renders update details, copies the Homebrew command, and opens release notes', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'update:get-status') return makeStatus();
      return null;
    });

    renderBanner();

    expect(await screen.findByText(/ShipCode v0.2.0 is available/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('brew upgrade --cask shipcode');
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Release notes' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/shipshitdev/shipcode/releases/tag/v0.2.0',
      });
    });
  });

  it('hides when there is no update, after dismissing the current tag, and for missing latest version', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'update:get-status') return makeStatus();
      return null;
    });

    renderBanner();

    expect(await screen.findByText(/ShipCode v0.2.0 is available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText(/ShipCode v0.2.0 is available/)).not.toBeInTheDocument();
    });

    statusListener?.(makeStatus({ releaseTag: 'v0.4.0', latest: '0.4.0' }));
    expect(await screen.findByText(/ShipCode v0.4.0 is available/)).toBeInTheDocument();
    statusListener?.(makeStatus({ releaseTag: 'v0.5.0', latest: '0.5.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText(/ShipCode v0.5.0 is available/)).toBeInTheDocument();

    statusListener?.(makeStatus({ releaseTag: 'v0.3.0', latest: '0.3.0' }));
    expect(await screen.findByText(/ShipCode v0.3.0 is available/)).toBeInTheDocument();

    statusListener?.(makeStatus({ hasUpdate: false }));
    await waitFor(() => {
      expect(screen.queryByText(/ShipCode v/)).not.toBeInTheDocument();
    });

    statusListener?.(makeStatus({ latest: null }));
    await waitFor(() => {
      expect(screen.queryByText(/ShipCode v/)).not.toBeInTheDocument();
    });
  });

  it('omits release notes when the status has no release URL', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'update:get-status') return makeStatus({ releaseUrl: null });
      return null;
    });

    renderBanner();

    expect(await screen.findByText(/ShipCode v0.2.0 is available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release notes' })).not.toBeInTheDocument();
  });

  it('renders without an update event subscription and ignores dismisses without a tag', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'update:get-status') return makeStatus({ releaseTag: null });
      return null;
    });
    delete (window.shipcode as { on?: typeof window.shipcode.on }).on;

    renderBanner();

    expect(await screen.findByText(/ShipCode v0.2.0 is available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText(/ShipCode v0.2.0 is available/)).toBeInTheDocument();
  });
});
