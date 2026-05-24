// @vitest-environment jsdom

import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutSettingsSection } from './AboutSettingsSection';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();

  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        {children}
        <button
          type="button"
          data-testid="select-update-stable"
          onClick={() => onValueChange('stable')}
        >
          select stable
        </button>
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
  };
});

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  window.shipcode = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'developer:get-info') {
        return {
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
      }
      if (channel === 'update:get-status') {
        return {
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
      }
      return undefined;
    }) as unknown as typeof window.shipcode.invoke,
    on: vi.fn(() => vi.fn()) as unknown as typeof window.shipcode.on,
  };
});

afterEach(() => {
  cleanup();
});

describe('AboutSettingsSection callback coverage', () => {
  it('updates the selected update track', () => {
    const onUpdate = vi.fn();

    renderWithClient(<AboutSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTestId('select-update-stable'));

    expect(onUpdate).toHaveBeenCalledWith({ updateTrack: 'stable' });
  });
});
