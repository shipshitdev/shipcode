import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import { getProjectProviderWarnings } from './provider-usage';
import type { CliHealth, CliProviderUsageMap, CliProviderUsageStatus, Project } from './types';

const readyCli: CliHealth = {
  available: true,
  version: '1.0.0',
  path: '/usr/local/bin/tool',
  error: null,
  authenticated: true,
};

function makeUsage(
  provider: 'claude' | 'codex',
  overrides: Partial<CliProviderUsageStatus>,
): CliProviderUsageStatus {
  return {
    provider,
    available: true,
    stale: false,
    state: 'ready',
    source: 'cli',
    version: '1.0.0',
    accountEmail: 'vincent@shipshit.dev',
    loginMethod: 'pro',
    updatedAt: '2026-04-16T16:00:00.000Z',
    checkedAt: '2026-04-16T16:01:00.000Z',
    message: null,
    creditsRemaining: null,
    windows: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: true,
    gitRemote: null,
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
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

function makeUsageMap(overrides: Partial<CliProviderUsageMap> = {}): CliProviderUsageMap {
  return {
    claude: makeUsage('claude', {
      windows: [
        {
          key: 'session',
          label: 'Session',
          usedPercent: 10,
          leftPercent: 90,
          resetsAt: null,
          resetDescription: null,
        },
        {
          key: 'weekly',
          label: 'Weekly',
          usedPercent: 20,
          leftPercent: 80,
          resetsAt: null,
          resetDescription: null,
        },
        {
          key: 'model',
          label: 'Sonnet',
          usedPercent: 30,
          leftPercent: 70,
          resetsAt: null,
          resetDescription: null,
        },
      ],
    }),
    codex: makeUsage('codex', {
      windows: [
        {
          key: 'session',
          label: 'Session',
          usedPercent: 10,
          leftPercent: 90,
          resetsAt: null,
          resetDescription: null,
        },
        {
          key: 'weekly',
          label: 'Weekly',
          usedPercent: 20,
          leftPercent: 80,
          resetsAt: null,
          resetDescription: null,
        },
      ],
      creditsRemaining: 0,
    }),
    ...overrides,
  };
}

describe('getProjectProviderWarnings', () => {
  it('blocks codex projects when the session window is exhausted', () => {
    const project = makeProject({ executorModelOverride: 'codex' });
    const usage = makeUsageMap({
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
      }),
    });

    const warnings = getProjectProviderWarnings(
      DEFAULT_SETTINGS,
      project,
      { claude: readyCli, codex: readyCli },
      usage,
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          severity: 'blocked',
          message: 'Codex CLI session exhausted',
        }),
      ]),
    );
  });

  it('does not block codex when weekly is exhausted but paid credits remain', () => {
    const project = makeProject({ executorModelOverride: 'codex' });
    const usage = makeUsageMap({
      codex: makeUsage('codex', {
        windows: [
          {
            key: 'session',
            label: 'Session',
            usedPercent: 30,
            leftPercent: 70,
            resetsAt: null,
            resetDescription: null,
          },
          {
            key: 'weekly',
            label: 'Weekly',
            usedPercent: 100,
            leftPercent: 0,
            resetsAt: null,
            resetDescription: null,
          },
        ],
        creditsRemaining: 25,
      }),
    });

    const warnings = getProjectProviderWarnings(
      DEFAULT_SETTINGS,
      project,
      { claude: readyCli, codex: readyCli },
      usage,
    );

    expect(warnings).toEqual([]);
  });

  it('blocks claude opus selections when the opus window is exhausted', () => {
    const project = makeProject({
      executorModelOverride: 'claude',
      executorModelIdOverride: 'claude-opus-4-6',
    });
    const usage = makeUsageMap({
      claude: makeUsage('claude', {
        windows: [
          {
            key: 'session',
            label: 'Session',
            usedPercent: 10,
            leftPercent: 90,
            resetsAt: null,
            resetDescription: null,
          },
          {
            key: 'weekly',
            label: 'Weekly',
            usedPercent: 20,
            leftPercent: 80,
            resetsAt: null,
            resetDescription: null,
          },
          {
            key: 'model',
            label: 'Opus',
            usedPercent: 100,
            leftPercent: 0,
            resetsAt: null,
            resetDescription: null,
          },
        ],
      }),
    });

    const warnings = getProjectProviderWarnings(
      DEFAULT_SETTINGS,
      project,
      { claude: readyCli, codex: readyCli },
      usage,
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'claude',
          severity: 'blocked',
          message: 'Claude CLI opus quota exhausted',
        }),
      ]),
    );
  });

  it('allows claude sonnet selections when the weekly pool is empty but the sonnet window remains', () => {
    const project = makeProject({
      executorModelOverride: 'claude',
      executorModelIdOverride: 'claude-sonnet-4-6',
    });
    const usage = makeUsageMap({
      claude: makeUsage('claude', {
        windows: [
          {
            key: 'session',
            label: 'Session',
            usedPercent: 10,
            leftPercent: 90,
            resetsAt: null,
            resetDescription: null,
          },
          {
            key: 'weekly',
            label: 'Weekly',
            usedPercent: 100,
            leftPercent: 0,
            resetsAt: null,
            resetDescription: null,
          },
          {
            key: 'model',
            label: 'Sonnet',
            usedPercent: 54,
            leftPercent: 46,
            resetsAt: null,
            resetDescription: null,
          },
        ],
      }),
    });

    const warnings = getProjectProviderWarnings(
      DEFAULT_SETTINGS,
      project,
      { claude: readyCli, codex: readyCli },
      usage,
    );

    expect(warnings).toEqual([]);
  });

  it('keeps all affected phases when multiple selections share the same CLI warning', () => {
    const project = makeProject({
      plannerModelOverride: 'codex',
      executorModelOverride: 'codex',
    });
    const usage = makeUsageMap({
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
      }),
    });

    const warnings = getProjectProviderWarnings(
      DEFAULT_SETTINGS,
      project,
      { claude: readyCli, codex: readyCli },
      usage,
    );

    expect(warnings).toEqual([
      expect.objectContaining({
        provider: 'codex',
        severity: 'blocked',
        message: 'Codex CLI session exhausted',
        phases: ['planner', 'reviewer', 'executor'],
      }),
    ]);
  });
});
