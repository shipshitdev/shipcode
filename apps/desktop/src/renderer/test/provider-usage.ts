import type {
  CliProviderUsageMap,
  CliProviderUsageProvider,
  CliProviderUsageStatus,
  CliProviderUsageWindow,
} from '@shipcode/shared';

function usageWindow(
  key: CliProviderUsageWindow['key'],
  label: string,
  usedPercent: number,
): CliProviderUsageWindow {
  return {
    key,
    label,
    usedPercent,
    leftPercent: 100 - usedPercent,
    resetsAt: null,
    resetDescription: null,
  };
}

const providerWindows: Record<CliProviderUsageProvider, CliProviderUsageWindow[]> = {
  claude: [
    usageWindow('session', 'Session', 10),
    usageWindow('weekly', 'Weekly', 20),
    usageWindow('model', 'Sonnet', 30),
  ],
  codex: [usageWindow('session', 'Session', 10), usageWindow('weekly', 'Weekly', 20)],
};

export function makeProviderUsageStatus(
  provider: CliProviderUsageProvider,
  overrides: Partial<CliProviderUsageStatus> = {},
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
    windows: providerWindows[provider].map((window) => ({ ...window })),
    ...overrides,
  };
}

export function makeProviderUsageMap(
  overrides: Partial<CliProviderUsageMap> = {},
): CliProviderUsageMap {
  return {
    claude: makeProviderUsageStatus('claude'),
    codex: makeProviderUsageStatus('codex'),
    ...overrides,
  };
}
