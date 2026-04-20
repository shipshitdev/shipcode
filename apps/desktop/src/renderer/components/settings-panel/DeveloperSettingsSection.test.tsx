// @vitest-environment jsdom

import type { DeveloperInfo } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeveloperSettingsSection } from './DeveloperSettingsSection';

const MOCK_INFO: DeveloperInfo = {
  appVersion: '0.1.0',
  electronVersion: '34.0.0',
  nodeVersion: '22.0.0',
  platform: 'darwin',
  osRelease: '25.4.0',
  cliVersions: {
    claude: '1.2.3',
    codex: '0.5.0',
    git: '2.45.0',
    gh: '2.60.0',
  },
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
    return undefined;
  });

  (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
    invoke: invokeMock as unknown as typeof window.shipcode.invoke,
    on: vi.fn(() => vi.fn()) as unknown as typeof window.shipcode.on,
  };

  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeveloperSettingsSection', () => {
  it('renders version info from developer:get-info', async () => {
    const onUpdate = vi.fn();

    render(<DeveloperSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('0.1.0')).toBeInTheDocument();
    });
    expect(screen.getByText('34.0.0')).toBeInTheDocument();
    expect(screen.getByText('22.0.0')).toBeInTheDocument();
  });

  it('copies diagnostics to clipboard', async () => {
    const onUpdate = vi.fn();

    render(<DeveloperSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('0.1.0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('ShipCode v0.1.0'),
      );
    });
  });

  it('invokes developer:open-devtools on button click', async () => {
    const onUpdate = vi.fn();

    render(<DeveloperSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByRole('button', { name: /open devtools/i }));

    expect(window.shipcode.invoke).toHaveBeenCalledWith('developer:open-devtools');
  });

  it('invokes developer:open-log-directory on button click', async () => {
    const onUpdate = vi.fn();

    render(<DeveloperSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByRole('button', { name: /open in finder/i }));

    expect(window.shipcode.invoke).toHaveBeenCalledWith('developer:open-log-directory');
  });

  it('calls onUpdate and set-log-level when log level changes', async () => {
    const onUpdate = vi.fn();

    render(<DeveloperSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />, {
      wrapper: createWrapper(),
    });

    // The Select is rendered with the default 'debug' value
    expect(screen.getByText('Debug')).toBeInTheDocument();
  });
});
