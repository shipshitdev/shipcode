// @vitest-environment jsdom

import type { Project, SystemHealth } from '@shipcode/shared';
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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: true,
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
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
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;

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
  });

  it('renders the global shell and toggles sidebar, terminal, and settings state', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'health:check') return readyHealth;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return null;
    });

    renderWithProviders();

    expect(await screen.findByTitle('Show terminal')).toBeInTheDocument();

    const sidebarButton = screen.getByTitle('Hide sidebar');
    fireEvent.click(sidebarButton);
    await waitFor(() => {
      expect(screen.getByTitle('Show sidebar')).toBeInTheDocument();
    });

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

  it('shows the active project and blocked provider badge when project model selection is exhausted', async () => {
    const project = makeProject({
      executorModelOverride: 'codex',
      name: 'Mission Control',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
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

    useAppStore.setState({ activeProjectId: project.id });

    renderWithProviders();

    expect(await screen.findByText('Mission Control')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Project model warnings for Mission Control' }),
    );
    expect(await screen.findByText('Selected models vs CLI status')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI session exhausted')).toBeInTheDocument();
    expect(screen.getByText('CLI')).toBeInTheDocument();
  });
});
