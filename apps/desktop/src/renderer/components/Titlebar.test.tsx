// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { SystemHealth } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import {
  makeProviderUsageStatus as makeUsage,
  makeProviderUsageMap as makeUsageMap,
} from '../test/provider-usage';
import { renderWithQueryClient } from '../test/render';
import { Titlebar } from './Titlebar';

function renderWithProviders() {
  return renderWithQueryClient(<Titlebar />);
}

describe('Titlebar', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const readyHealth: SystemHealth = {
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
      version: '2.0.0',
      path: '/usr/bin/git',
      error: null,
      authenticated: false,
    },
    gh: {
      available: true,
      version: '2.0.0',
      path: '/usr/local/bin/gh',
      error: null,
      authenticated: false,
    },
  };
  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: null,
      settingsVisible: false,
      sidebarCollapsed: false,
      terminalVisible: false,
      terminalMaximized: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the global shell and toggles sidebar, terminal, and settings state', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return null;
    });

    renderWithProviders();

    expect(await screen.findByTitle('Open agent')).toBeInTheDocument();
    expect(await screen.findByTitle('Show terminal')).toBeInTheDocument();
    expect(screen.getByText('ShipCode')).toBeInTheDocument();
    expect(screen.queryByTestId('project-switcher')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-board')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-inbox')).not.toBeInTheDocument();

    const sidebarButton = screen.getByTitle('Hide sidebar');
    fireEvent.click(sidebarButton);
    await waitFor(() => {
      expect(screen.getByTitle('Show sidebar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Open agent'));
    await waitFor(() => {
      expect(useAppStore.getState().assistantVisible).toBe(true);
    });
    expect(screen.getByTitle('Hide agent')).toBeInTheDocument();

    const terminalButton = screen.getByTitle('Show terminal');
    fireEvent.click(terminalButton);
    await waitFor(() => {
      expect(screen.getByTitle('Hide terminal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Toggle Settings'));
    await waitFor(() => {
      expect(screen.queryByTitle('Hide terminal')).not.toBeInTheDocument();
    });
  });

  it('renders exactly two provider dots in the pill even when usage data is unavailable', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') {
        return makeUsageMap({
          claude: makeUsage('claude', {
            available: false,
            state: 'unknown',
            message: 'Claude CLI returned no quota data',
            windows: [],
          }),
          codex: makeUsage('codex', {
            available: false,
            state: 'unknown',
            message: 'Codex CLI returned no quota data',
            windows: [],
          }),
        });
      }
      return null;
    });

    renderWithProviders();

    const trigger = await screen.findByRole('button', { name: 'CLI availability' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector('[title^="Codex:"]')).not.toBeNull();
    expect(trigger.querySelector('[title^="Claude:"]')).not.toBeNull();
  });

  it('shows high-CPU managed tasks and can kill a selected process', async () => {
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'process:list-resource-usage') {
        return {
          capturedAt: '2026-05-08T10:00:00.000Z',
          cpuPercent: 92,
          cpuCoreCount: 8,
          highCpu: true,
          tasks: [
            {
              processId: 'proc-hot',
              type: 'shell',
              state: 'running',
              pid: 1234,
              childPids: [1235],
              threadId: 'thread-1',
              projectId: 'project-1',
              projectName: 'ShipCode',
              threadTitle: 'Run all tests',
              phase: 'testing',
              cwd: '/tmp/shipcode',
              command: '/bin/zsh',
              cpuPercent: 148.2,
              memoryBytes: 512 * 1024 * 1024,
              startedAt: Date.now(),
              lastEventAt: Date.now(),
              highCpu: true,
            },
          ],
        };
      }
      if (channel === 'process:kill') return { killed: args };
      return null;
    });

    renderWithProviders();

    const trigger = await screen.findByRole('button', { name: 'CPU usage' });
    expect(trigger).toHaveTextContent('CPU 92%');
    fireEvent.click(trigger);

    expect(await screen.findByText('Run all tests')).toBeInTheDocument();
    expect(screen.getByText('148.2%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kill Run all tests' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('process:kill', { processId: 'proc-hot' });
    });
  });

  it('renders warmup CPU state and empty managed task list', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'process:list-resource-usage') {
        return {
          capturedAt: '2026-05-08T10:00:00.000Z',
          cpuPercent: null,
          cpuCoreCount: 10,
          highCpu: false,
          tasks: [],
        };
      }
      return null;
    });

    renderWithProviders();

    const trigger = await screen.findByRole('button', { name: 'CPU usage' });
    expect(trigger).toHaveTextContent('CPU —');
    fireEvent.click(trigger);

    expect(await screen.findByText('10 cores · warming up')).toBeInTheDocument();
    expect(screen.getByText('No managed processes are running.')).toBeInTheDocument();
  });

  it('opens a popover with the full CLI summary when the pill is clicked and closes on Escape', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') {
        return makeUsageMap({
          claude: makeUsage('claude', {
            version: '1.2.3',
            accountEmail: 'vincent@shipshit.dev',
            loginMethod: 'MAX',
            windows: [
              {
                key: 'session',
                label: 'Session',
                usedPercent: 42,
                leftPercent: 58,
                resetsAt: null,
                resetDescription: 'resets 6am (Europe/Malta)',
              },
            ],
          }),
          codex: makeUsage('codex', {
            version: '0.9.0',
            accountEmail: null,
            loginMethod: null,
            creditsRemaining: 1200,
            windows: [
              {
                key: 'session',
                label: 'Session',
                usedPercent: 10,
                leftPercent: 90,
                resetsAt: null,
                resetDescription: 'in 5h',
              },
            ],
          }),
        });
      }
      return null;
    });

    renderWithProviders();

    const trigger = await screen.findByRole('button', { name: 'CLI availability' });
    fireEvent.click(trigger);

    const heading = await screen.findByText('CLI availability');
    expect(heading).toBeInTheDocument();
    expect(screen.queryByText('vincent@shipshit.dev')).not.toBeInTheDocument();
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    expect(screen.getByText('v0.9.0')).toBeInTheDocument();
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText(/58% left · resets 6am \(Europe\/Malta\)/)).toBeInTheDocument();
    expect(screen.getByText(/90% left · in 5h/)).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('CLI availability')).not.toBeInTheDocument();
    });
  });

  it('refreshes provider usage and formats stale checked-at states', async () => {
    const now = Date.now();
    const initialUsage = makeUsageMap({
      codex: makeUsage('codex', {
        state: 'warning',
        stale: true,
        checkedAt: new Date(now - 20_000).toISOString(),
        windows: [
          {
            key: 'session',
            label: 'Session',
            usedPercent: null,
            leftPercent: null,
            resetsAt: null,
            resetDescription: null,
          },
        ],
      }),
      claude: makeUsage('claude', {
        checkedAt: 'invalid-date',
        windows: [],
        message: null,
        available: false,
      }),
    });
    const refreshedUsage = makeUsageMap({
      codex: makeUsage('codex', {
        state: 'ready',
        checkedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      }),
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') {
        return (args as { force?: boolean } | undefined)?.force ? refreshedUsage : initialUsage;
      }
      return null;
    });

    renderWithProviders();

    const trigger = await screen.findByRole('button', { name: 'CLI availability' });
    fireEvent.click(trigger);

    expect(await screen.findByText('Checked just now')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByText('Usage data unavailable.')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Refresh CLI status'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('provider-usage:check', { force: true });
    });
    expect(await screen.findByText(/Checked 2h ago/)).toBeInTheDocument();
  });

  it('falls back to the provider message inside the popover when usage data is missing', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') {
        return makeUsageMap({
          claude: makeUsage('claude', {
            available: false,
            state: 'unknown',
            message: 'Claude CLI returned no quota data',
            windows: [],
          }),
          codex: makeUsage('codex', {
            available: false,
            state: 'unknown',
            message: 'Codex CLI returned no quota data',
            windows: [],
          }),
        });
      }
      return null;
    });

    renderWithProviders();

    const trigger = await screen.findByRole('button', { name: 'CLI availability' });
    fireEvent.click(trigger);

    expect(await screen.findByText(/Claude CLI returned no quota data/)).toBeInTheDocument();
    expect(screen.getByText(/Codex CLI returned no quota data/)).toBeInTheDocument();
    expect(screen.getAllByText(/Retries on the next check/)).toHaveLength(2);
  });

  it('shows the blocked CLI pill without a project switcher in the titlebar', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') {
        return makeUsageMap({
          codex: makeUsage('codex', {
            windows: [
              {
                key: 'session',
                label: 'Session',
                usedPercent: 100,
                leftPercent: 0,
                resetsAt: null,
                resetDescription: 'in 2h',
              },
              {
                key: 'weekly',
                label: 'Weekly',
                usedPercent: 40,
                leftPercent: 60,
                resetsAt: null,
                resetDescription: null,
              },
            ],
            state: 'blocked',
          }),
        });
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByRole('button', { name: 'CLI availability' })).toBeInTheDocument();
    expect(screen.queryByTestId('project-switcher')).not.toBeInTheDocument();
    expect(screen.getByText('CLI')).toBeInTheDocument();
  });
});
