// @vitest-environment jsdom

import { DEFAULT_SETTINGS, type TelemetryStatus } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppSettings } from './useAppSettings';
import { useTelemetryStatus } from './useTelemetryStatus';

const TELEMETRY_STATUS: TelemetryStatus = {
  enabled: false,
  initialized: false,
  envDisabled: false,
  dsnConfigured: true,
  pendingConsent: false,
  disabledReason: 'disabled-by-user',
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('app settings queries', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'telemetry:get-status') return TELEMETRY_STATUS;
      return null;
    });
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
  });

  it('loads app settings through the shared query contract by default', async () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toEqual(DEFAULT_SETTINGS);
    });
    expect(invokeMock).toHaveBeenCalledWith('settings:get');
  });

  it('defers app settings until a disabled subscriber becomes enabled', async () => {
    const { rerender } = renderHook(({ enabled }) => useAppSettings({ enabled }), {
      initialProps: { enabled: false },
      wrapper: createWrapper(),
    });

    expect(invokeMock).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('settings:get');
    });
  });

  it('loads telemetry status through its shared query contract', async () => {
    const { result } = renderHook(() => useTelemetryStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toEqual(TELEMETRY_STATUS);
    });
    expect(invokeMock).toHaveBeenCalledWith('telemetry:get-status');
  });
});
