import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';
import { SettingsPanel } from './SettingsPanel';

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPanel />
    </QueryClientProvider>,
  );
}

describe('SettingsPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    useAppStore.setState({
      settingsSection: 'pipeline',
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders and updates maxConcurrentPipelines from the Pipeline section', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      maxConcurrentPipelines: 3,
    };

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'settings:set') return undefined;
      return args ?? null;
    });

    renderPanel();

    const input = await screen.findByLabelText('Max concurrent pipelines');
    expect(input).toHaveValue(3);

    fireEvent.change(input, { target: { value: '6' } });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('settings:set', {
        maxConcurrentPipelines: 6,
      });
    });
  });
});
