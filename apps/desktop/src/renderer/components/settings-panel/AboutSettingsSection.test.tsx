// @vitest-environment jsdom

import type { DeveloperInfo, UpdateStatus } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutSettingsSection } from './AboutSettingsSection';

const MOCK_INFO: DeveloperInfo = {
  appVersion: '0.1.0',
  electronVersion: '34.0.0',
  nodeVersion: '22.0.0',
  platform: 'darwin',
  osRelease: '25.4.0',
  logDirectoryPath: '/tmp/shipcode/logs',
  eventLogPath: '/tmp/shipcode/logs/events.log',
  cliVersions: {
    claude: '1.2.3',
    codex: '0.5.0',
    git: '2.45.0',
    gh: '2.60.0',
  },
};

const MOCK_UPDATE_STATUS: UpdateStatus = {
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (channel: string) => {
    if (channel === 'developer:get-info') return MOCK_INFO;
    if (channel === 'update:get-status') return MOCK_UPDATE_STATUS;
    if (channel === 'update:check-now') return { ...MOCK_UPDATE_STATUS, state: 'up-to-date' };
    return undefined;
  });

  window.shipcode = {
    invoke: invokeMock as unknown as typeof window.shipcode.invoke,
    on: vi.fn(() => vi.fn()) as unknown as typeof window.shipcode.on,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AboutSettingsSection', () => {
  it('renders app version, update track, and log directory path', async () => {
    const onUpdate = vi.fn();

    render(<AboutSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
    expect(
      screen.getByText(/Master is the only published update track today/i),
    ).toBeInTheDocument();
  });

  it('runs a manual update check from the version row', async () => {
    const onUpdate = vi.fn();

    render(<AboutSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(await screen.findByRole('button', { name: /check now/i }));

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('update:check-now');
    });
    expect(await screen.findByRole('button', { name: /up to date/i })).toBeInTheDocument();
  });

  it('renders pending and checking update states', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'developer:get-info') return MOCK_INFO;
      if (channel === 'update:get-status') {
        return {
          ...MOCK_UPDATE_STATUS,
          checkedAt: '2026-05-10T07:00:00.000Z',
          state: 'checking',
        } satisfies UpdateStatus;
      }
      return undefined;
    });

    render(<AboutSettingsSection settings={DEFAULT_SETTINGS} onUpdate={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument();
    expect(screen.getByText(/No update check has run yet/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /checking/i })).toBeDisabled();
    expect(screen.getByText(/Checked /i)).toBeInTheDocument();
  });

  it('renders available and failed update states from status data and events', async () => {
    let statusListener: ((status: UpdateStatus) => void) | undefined;
    const unsubscribe = vi.fn();
    const availableStatus = {
      ...MOCK_UPDATE_STATUS,
      latest: '0.2.0',
      hasUpdate: true,
      checkedAt: '2026-05-10T07:10:00.000Z',
      state: 'available',
    } satisfies UpdateStatus;

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'developer:get-info') return MOCK_INFO;
      if (channel === 'update:get-status') return availableStatus;
      return undefined;
    });
    window.shipcode.on = vi.fn((channel, callback) => {
      if (channel === 'update:status-changed') {
        statusListener = callback as (status: UpdateStatus) => void;
      }
      return unsubscribe;
    }) as unknown as typeof window.shipcode.on;

    const { unmount } = render(
      <AboutSettingsSection settings={DEFAULT_SETTINGS} onUpdate={vi.fn()} />,
      {
        wrapper: createWrapper(),
      },
    );

    expect(await screen.findByRole('button', { name: /v0.2.0 available/i })).toBeInTheDocument();

    statusListener?.({
      ...MOCK_UPDATE_STATUS,
      checkedAt: '2026-05-10T07:15:00.000Z',
      state: 'error',
      error: 'network down',
    });

    expect(await screen.findByRole('button', { name: /check failed/i })).toBeInTheDocument();
    expect(screen.getByText(/Last check failed .*network down/i)).toBeInTheDocument();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('renders without subscribing when update status events are unavailable', async () => {
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: undefined as unknown as typeof window.shipcode.on,
    };

    render(<AboutSettingsSection settings={DEFAULT_SETTINGS} onUpdate={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByText('0.1.0')).toBeInTheDocument();
  });
});
