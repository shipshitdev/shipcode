// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { UpdateStatus } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStatus } from './useUpdateStatus';

const INITIAL_STATUS: UpdateStatus = {
  current: '0.1.0',
  latest: null,
  hasUpdate: false,
  releaseUrl: null,
  releaseTag: null,
  publishedAt: null,
  checkedAt: null,
  state: 'idle',
  error: null,
};

function UpdateStatusHarness() {
  const updateStatus = useUpdateStatus();
  return <span>{updateStatus?.latest ?? 'none'}</span>;
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UpdateStatusHarness />
    </QueryClientProvider>,
  );
}

describe('useUpdateStatus', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  let statusListener: ((status: UpdateStatus) => void) | null = null;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    statusListener = null;
    invokeMock.mockResolvedValue(INITIAL_STATUS);
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn((channel, listener) => {
        if (channel === 'update:status-changed') {
          statusListener = listener as (status: UpdateStatus) => void;
        }
        return unsubscribe;
      }) as unknown as typeof window.shipcode.on,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches update status, reconciles status events, and unsubscribes on unmount', async () => {
    const view = renderHarness();

    expect(await screen.findByText('none')).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update:get-status');
    });

    act(() => {
      statusListener?.({ ...INITIAL_STATUS, latest: '0.2.0', hasUpdate: true });
    });

    expect(await screen.findByText('0.2.0')).toBeInTheDocument();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('still fetches when update status events are unavailable', async () => {
    window.shipcode.on = undefined as unknown as typeof window.shipcode.on;

    renderHarness();

    expect(await screen.findByText('none')).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update:get-status');
    });
  });
});
