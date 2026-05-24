// @vitest-environment jsdom

import type { SystemHealth } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthBanner } from './HealthBanner';

const healthySystem: SystemHealth = {
  claude: {
    available: true,
    authenticated: true,
    version: '1.0.0',
    path: '/usr/local/bin/claude',
    error: null,
  },
  codex: {
    available: true,
    authenticated: true,
    version: '1.0.0',
    path: '/usr/local/bin/codex',
    error: null,
  },
  git: {
    available: true,
    authenticated: false,
    version: '2.0.0',
    path: '/usr/bin/git',
    error: null,
  },
  gh: {
    available: true,
    authenticated: false,
    version: '2.0.0',
    path: '/usr/local/bin/gh',
    error: null,
  },
};

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <HealthBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  window.shipcode = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'health:check') return healthySystem;
      if (channel === 'settings:set') return undefined;
      return null;
    }) as unknown as typeof window.shipcode.invoke,
    on: vi.fn(() => vi.fn()) as unknown as typeof window.shipcode.on,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HealthBanner', () => {
  it('renders no banner before health loads or when the system is healthy', async () => {
    let resolveHealth: ((health: SystemHealth) => void) | undefined;
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'health:check') {
        return await new Promise<SystemHealth>((resolve) => {
          resolveHealth = resolve;
        });
      }
      return null;
    }) as unknown as typeof window.shipcode.invoke;

    const { container } = renderWithClient();

    expect(container.textContent).toBe('');

    resolveHealth?.({
      ...healthySystem,
      gh: { ...healthySystem.gh, available: false },
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows missing CLI and auth warnings and can reset onboarding', async () => {
    const degradedHealth: SystemHealth = {
      ...healthySystem,
      claude: { ...healthySystem.claude, available: false, authenticated: false },
      codex: { ...healthySystem.codex, authenticated: false },
      git: { ...healthySystem.git, available: false },
      gh: { ...healthySystem.gh, available: false },
    };
    window.shipcode.invoke = vi.fn(async (channel: string, args?: unknown) => {
      if (channel === 'health:check') return degradedHealth;
      if (channel === 'settings:set') return args;
      return null;
    }) as unknown as typeof window.shipcode.invoke;

    renderWithClient();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Claude CLI not found');
    expect(alert).toHaveTextContent('Codex CLI not authenticated');
    expect(alert).toHaveTextContent('Git not found');

    fireEvent.click(screen.getByRole('button', { name: 'Re-run Setup' }));

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('settings:set', { onboardingVersion: 0 });
    });
  });

  it('shows missing Codex and Claude authentication warnings', async () => {
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'health:check') {
        return {
          ...healthySystem,
          claude: { ...healthySystem.claude, authenticated: false },
          codex: { ...healthySystem.codex, available: false, authenticated: false },
          gh: { ...healthySystem.gh, available: false },
        } satisfies SystemHealth;
      }
      return null;
    }) as unknown as typeof window.shipcode.invoke;

    renderWithClient();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Codex CLI not found');
    expect(alert).toHaveTextContent('Claude CLI not authenticated');
  });

  it('warns when gh is authenticated without project scope', async () => {
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'health:check') return healthySystem;
      if (channel === 'onboarding:check-auth') {
        return {
          ...healthySystem,
          ghAuth: {
            installed: true,
            authenticated: true,
            username: 'decod3rs',
            version: '2.0.0',
            error: null,
            hasProjectScope: false,
          },
        };
      }
      return null;
    }) as unknown as typeof window.shipcode.invoke;

    renderWithClient();

    expect(await screen.findByRole('alert', {}, { timeout: 3_500 })).toHaveTextContent(
      'gh missing `project` scope',
    );
  });
});
