import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories, making these available inside them
const { mockExec, mockExecFileSync, mockAccess, mockHomedir, mockMkdir, mockPtySpawn } = vi.hoisted(
  () => ({
    mockExec: vi.fn(),
    mockExecFileSync: vi.fn(),
    mockAccess: vi.fn(),
    mockHomedir: vi.fn(() => '/mock/home'),
    mockMkdir: vi.fn(),
    mockPtySpawn: vi.fn(),
  }),
);

vi.mock('node:child_process', () => ({ exec: mockExec, execFileSync: mockExecFileSync }));
vi.mock('node:fs/promises', () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:os', () => ({ homedir: mockHomedir }));
vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));

import { type AppSettings, DEFAULT_SETTINGS } from '@shipcode/shared';
import {
  __resetHealthCheckCachesForTests,
  checkClaudeAuth,
  checkCliProviderUsage,
  checkCodexAuth,
  checkDesktopApps,
  checkGeminiAuth,
  checkGeminiModelCapabilities,
  checkGhAuth,
  checkIntegrationStatus,
  checkOpenRouterAuth,
  checkOpenRouterHealth,
  checkSystemHealth,
  checkSystemHealthWithAuth,
  parseClaudeAuthStatusOutput,
  parseClaudeUsageText,
  parseCodexDebugModels,
  parseCodexStatusText,
  parseGhProjectScope,
  shellExecEnv,
  validateOpenRouterModel,
} from './health-check';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

type ExecCallback = (error: Error | null, result?: { stdout?: string; stderr?: string }) => void;

// Helper: make mockExec resolve with given stdout/stderr
function execSucceeds(stdout = '', stderr = '') {
  mockExec.mockImplementation((_cmd: string, opts: unknown, cb?: unknown) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    (cb as ExecCallback)(null, { stdout, stderr });
  });
}

// Helper: make mockExec reject with an error
function execFails(message = 'command failed') {
  mockExec.mockImplementation((_cmd: string, opts: unknown, cb?: unknown) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    (cb as ExecCallback)(new Error(message));
  });
}

// Helper: route exec results by command prefix
function execRouted(routes: Record<string, { stdout?: string; stderr?: string } | Error>) {
  mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    for (const [prefix, result] of Object.entries(routes)) {
      if (cmd.startsWith(prefix) || cmd.includes(prefix)) {
        if (result instanceof Error) {
          (cb as ExecCallback)(result);
        } else {
          (cb as ExecCallback)(null, {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
          });
        }
        return;
      }
    }
    (cb as ExecCallback)(new Error(`unmatched command: ${cmd}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetHealthCheckCachesForTests();
  mockExecFileSync.mockReturnValue('');
  mockAccess.mockRejectedValue(new Error('ENOENT'));
  mockMkdir.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

function createMockPty(text: string) {
  let onData: ((chunk: string) => void) | null = null;
  let onExit: ((event: { exitCode: number }) => void) | null = null;
  let killed = false;
  let flushed = false;

  const flush = () => {
    if (flushed) return;
    flushed = true;
    queueMicrotask(() => {
      if (!killed) onData?.(text);
      onExit?.({ exitCode: 0 });
    });
  };

  return {
    write: vi.fn(() => {
      flush();
    }),
    kill: vi.fn(() => {
      killed = true;
      onExit?.({ exitCode: 0 });
    }),
    onData: vi.fn((handler: (chunk: string) => void) => {
      onData = handler;
      // Auto-flush after both handlers are registered (simulates CLI startup output)
      queueMicrotask(() => flush());
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      onExit = handler;
    }),
  };
}

function createCodexRefreshPty() {
  let onData: ((chunk: string) => void) | null = null;
  let onExit: ((event: { exitCode: number }) => void) | null = null;
  let killed = false;
  let statusWrites = 0;

  const emit = (text: string, exit = false) => {
    queueMicrotask(() => {
      if (killed) return;
      onData?.(text);
      if (exit) onExit?.({ exitCode: 0 });
    });
  };

  return {
    write: vi.fn((keys: string) => {
      if (!keys.includes('/status')) return;
      statusWrites += 1;
      if (statusWrites === 1) {
        emit('Limits: refresh requested; run /status again shortly.');
        return;
      }
      emit('5h limit 88% left resets in 4h 49m\nWeekly limit 64% left resets in 2d', true);
    }),
    kill: vi.fn(() => {
      killed = true;
      onExit?.({ exitCode: 0 });
    }),
    onData: vi.fn((handler: (chunk: string) => void) => {
      onData = handler;
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      onExit = handler;
    }),
  };
}

describe('shellExecEnv', () => {
  it('hydrates PATH from the login shell and keeps standard tool locations available', () => {
    const previousBunInstall = process.env.BUN_INSTALL;
    const previousShell = process.env.SHELL;
    process.env.BUN_INSTALL = '';
    process.env.SHELL = '/bin/zsh';
    mockExecFileSync.mockReturnValue('/shell/bin:/usr/bin\n');

    try {
      const env = shellExecEnv();

      expect(env.PATH.split(':')).toEqual(
        expect.arrayContaining([
          '/shell/bin',
          '/mock/home/.bun/bin',
          '/mock/home/.local/bin',
          '/opt/homebrew/bin',
          '/usr/local/bin',
        ]),
      );
      expect(env.BUN_INSTALL).toBe('/mock/home/.bun');
      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'printf "%s" "$PATH"'], {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } finally {
      if (previousBunInstall === undefined) {
        delete process.env.BUN_INSTALL;
      } else {
        process.env.BUN_INSTALL = previousBunInstall;
      }
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// checkClaudeAuth
// ---------------------------------------------------------------------------
describe('checkClaudeAuth', () => {
  it('returns true when `claude auth status` succeeds', async () => {
    execSucceeds('Authenticated');
    const result = await checkClaudeAuth();
    expect(result).toBe(true);
  });

  it('returns true when command fails but credential file exists', async () => {
    execFails('not found');
    mockAccess.mockResolvedValue(undefined);
    const result = await checkClaudeAuth();
    expect(result).toBe(true);
  });

  it('returns false when both command and file check fail', async () => {
    execFails('not found');
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await checkClaudeAuth();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkCodexAuth
// ---------------------------------------------------------------------------
describe('checkCodexAuth', () => {
  it('returns true when env var is set (non-empty stdout)', async () => {
    execSucceeds('sk-abc123\n');
    const result = await checkCodexAuth();
    expect(result).toBe(true);
  });

  it('returns true when env var fails but auth config file exists', async () => {
    execFails('not set');
    mockAccess.mockResolvedValue(undefined);
    const result = await checkCodexAuth();
    expect(result).toBe(true);
  });

  it('returns false when both fail', async () => {
    execFails('not set');
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await checkCodexAuth();
    expect(result).toBe(false);
  });

  it('returns false when env var returns empty string', async () => {
    execSucceeds('');
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await checkCodexAuth();
    expect(result).toBe(false);
  });
});

describe('parseCodexDebugModels', () => {
  it('maps visible Codex catalog models and supported reasoning efforts', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.4',
            display_name: 'GPT-5.4',
            description: 'Everyday coding',
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
            visibility: 'list',
          },
          {
            slug: 'gpt-5.5',
            display_name: 'GPT-5.5',
            default_reasoning_level: 'high',
            supported_reasoning_levels: [{ effort: 'low' }, { effort: 'xhigh' }],
            visibility: 'list',
          },
          {
            slug: 'codex-auto-review',
            display_name: 'Codex Auto Review',
            visibility: 'hide',
          },
        ],
      }),
      '2026-04-24T00:00:00.000Z',
    );

    expect(result.source).toBe('catalog');
    expect(result.models.map((model) => model.value)).toEqual(['gpt-5.4', 'gpt-5.5']);
    expect(result.models[1].supportedReasoningEfforts).toEqual(['low', 'xhigh']);
  });
});

// ---------------------------------------------------------------------------
// checkGhAuth
// ---------------------------------------------------------------------------
describe('checkGhAuth', () => {
  it('returns installed=true, authenticated=true with username when auth succeeds', async () => {
    execSucceeds('Logged in to github.com as an account decod3r (token)');

    const result = await checkGhAuth();
    expect(result.installed).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.username).toBe('decod3r');
    expect(result.error).toBeNull();
  });

  it('returns username=null when regex does not match output format', async () => {
    execSucceeds('Authenticated but weird format');

    const result = await checkGhAuth();
    expect(result.installed).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.username).toBeNull();
  });

  it('returns installed=true, authenticated=false when auth fails but gh is installed', async () => {
    execRouted({
      'gh auth status': new Error('not logged in'),
      'which gh': { stdout: '/usr/local/bin/gh\n' },
    });

    const result = await checkGhAuth();
    expect(result.installed).toBe(true);
    expect(result.authenticated).toBe(false);
    expect(result.username).toBeNull();
    expect(result.error).toContain('not logged in');
  });

  it('returns installed=false when both auth and which fail', async () => {
    execFails('command not found');

    const result = await checkGhAuth();
    expect(result.installed).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.username).toBeNull();
    expect(result.error).toBe('gh not found in PATH');
  });

  it('parses hasProjectScope=true when project scope is in token scopes line', async () => {
    execSucceeds(
      "github.com\n  ✓ Logged in to github.com account decod3r (keyring)\n  - Token scopes: 'gist', 'read:org', 'repo', 'workflow', 'project'\n",
    );

    const result = await checkGhAuth();
    expect(result.hasProjectScope).toBe(true);
  });

  it('parses hasProjectScope=false when project scope is missing', async () => {
    execSucceeds(
      "github.com\n  ✓ Logged in to github.com account decod3r (keyring)\n  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n",
    );

    const result = await checkGhAuth();
    expect(result.hasProjectScope).toBe(false);
  });

  it('returns hasProjectScope=null when no Token scopes line is present', async () => {
    execSucceeds('Logged in to github.com account decod3r (token)');

    const result = await checkGhAuth();
    expect(result.hasProjectScope).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseGhProjectScope (pure)
// ---------------------------------------------------------------------------
describe('parseGhProjectScope', () => {
  it('returns true when "project" is in the comma-separated list', () => {
    expect(parseGhProjectScope("Token scopes: 'gist', 'read:org', 'repo', 'project'")).toBe(true);
  });

  it('returns false when only read:project (or none) is present', () => {
    // `gh project item-add` requires write — read:project alone is insufficient
    expect(parseGhProjectScope("Token scopes: 'gist', 'read:org', 'repo', 'read:project'")).toBe(
      false,
    );
    expect(parseGhProjectScope("Token scopes: 'gist', 'read:org', 'repo'")).toBe(false);
  });

  it('returns null when no Token scopes line is present', () => {
    expect(parseGhProjectScope('some other gh output')).toBeNull();
    expect(parseGhProjectScope('')).toBeNull();
  });

  it('handles unquoted scopes (older gh formats)', () => {
    expect(parseGhProjectScope('Token scopes: gist, read:org, repo, project')).toBe(true);
    expect(parseGhProjectScope('Token scopes: gist, read:org, repo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSystemHealth
// ---------------------------------------------------------------------------
describe('checkSystemHealth', () => {
  it('returns provider CLIs with correct availability', async () => {
    execRouted({
      which: { stdout: '/usr/local/bin/tool\n' },
      'claude --version': { stdout: 'claude 1.0.0' },
      'codex --version': { stdout: 'codex 0.1.0' },
      'gemini --version': { stdout: '0.1.0' },
      'git --version': { stdout: 'git version 2.43.0' },
      'gh --version': { stdout: 'gh version 2.40.1 (2024-01-01)' },
    });

    const result = await checkSystemHealth();
    expect(result.claude.available).toBe(true);
    expect(result.codex.available).toBe(true);
    expect(result.gemini?.available).toBe(true);
    expect(result.git.available).toBe(true);
    expect(result.gh.available).toBe(true);
  });

  it('handles mixed availability (some available, some not)', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      // git and gh are available, provider CLIs are not
      if (cmd.includes('which git') || cmd.includes('which gh')) {
        (cb as ExecCallback)(null, { stdout: '/usr/bin/tool', stderr: '' });
      } else if (
        cmd.includes('which claude') ||
        cmd.includes('which codex') ||
        cmd.includes('which gemini')
      ) {
        (cb as ExecCallback)(new Error('not found'));
      } else if (cmd.startsWith('git') || cmd.startsWith('gh')) {
        (cb as ExecCallback)(null, { stdout: 'version info', stderr: '' });
      } else {
        (cb as ExecCallback)(new Error('not found'));
      }
    });

    const result = await checkSystemHealth();
    expect(result.claude.available).toBe(false);
    expect(result.codex.available).toBe(false);
    expect(result.gemini?.available).toBe(false);
    expect(result.git.available).toBe(true);
    expect(result.gh.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSystemHealthWithAuth
// ---------------------------------------------------------------------------
describe('checkSystemHealthWithAuth', () => {
  it('sets authenticated=true when CLI available and auth passes', async () => {
    // All commands succeed — CLIs available and auth passes
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (cmd.includes('which')) {
        (cb as ExecCallback)(null, { stdout: '/usr/local/bin/tool', stderr: '' });
      } else if (cmd.includes('claude auth status')) {
        (cb as ExecCallback)(null, { stdout: 'Authenticated', stderr: '' });
      } else if (cmd.includes('printenv OPENAI_API_KEY')) {
        (cb as ExecCallback)(null, { stdout: 'sk-key', stderr: '' });
      } else if (cmd.includes('printenv GEMINI_API_KEY')) {
        (cb as ExecCallback)(null, { stdout: 'gemini-key', stderr: '' });
      } else {
        (cb as ExecCallback)(null, { stdout: 'version 1.0', stderr: '' });
      }
    });

    const result = await checkSystemHealthWithAuth();
    expect(result.claude.available).toBe(true);
    expect(result.claude.authenticated).toBe(true);
    expect(result.codex.available).toBe(true);
    expect(result.codex.authenticated).toBe(true);
    expect(result.gemini?.available).toBe(true);
    expect(result.gemini?.authenticated).toBe(true);
  });

  it('detects Gemini auth from environment', async () => {
    execRouted({
      'printenv GEMINI_API_KEY': { stdout: 'gemini-key\n' },
    });

    await expect(checkGeminiAuth()).resolves.toBe(true);
  });

  it('uses Gemini fallback model capabilities when the CLI is reachable', async () => {
    execRouted({
      'gemini --help': { stdout: 'Usage: gemini' },
    });

    const result = await checkGeminiModelCapabilities();
    expect(result.provider).toBe('gemini');
    expect(result.source).toBe('fallback');
    expect(result.models.map((model) => model.value)).toContain('gemini-2.5-pro');
  });

  it('sets authenticated=false when CLI available but auth fails', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (cmd.includes('which')) {
        (cb as ExecCallback)(null, { stdout: '/usr/local/bin/tool', stderr: '' });
      } else if (cmd.includes('claude auth status')) {
        (cb as ExecCallback)(new Error('not authenticated'));
      } else if (cmd.includes('printenv OPENAI_API_KEY')) {
        (cb as ExecCallback)(new Error('not set'));
      } else {
        (cb as ExecCallback)(null, { stdout: 'version 1.0', stderr: '' });
      }
    });
    // File checks also fail
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await checkSystemHealthWithAuth();
    expect(result.claude.available).toBe(true);
    expect(result.claude.authenticated).toBe(false);
    expect(result.codex.available).toBe(true);
    expect(result.codex.authenticated).toBe(false);
  });

  it('sets authenticated=false when CLI is not available', async () => {
    // All commands fail — nothing installed
    execFails('not found');
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await checkSystemHealthWithAuth();
    expect(result.claude.available).toBe(false);
    expect(result.claude.authenticated).toBe(false);
    expect(result.codex.available).toBe(false);
    expect(result.codex.authenticated).toBe(false);
  });

  it('reuses fresh cached auth health results until forced', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (cmd.includes('which')) {
        (cb as ExecCallback)(null, { stdout: '/usr/local/bin/tool', stderr: '' });
      } else if (cmd.includes('claude auth status')) {
        (cb as ExecCallback)(null, { stdout: 'Authenticated', stderr: '' });
      } else if (cmd.includes('printenv OPENAI_API_KEY')) {
        (cb as ExecCallback)(null, { stdout: 'sk-key', stderr: '' });
      } else {
        (cb as ExecCallback)(null, { stdout: 'version 1.0', stderr: '' });
      }
    });

    const first = await checkSystemHealthWithAuth();
    vi.clearAllMocks();

    const second = await checkSystemHealthWithAuth();
    expect(second).toEqual(first);
    expect(mockExec).not.toHaveBeenCalled();

    await checkSystemHealthWithAuth({ force: true });
    expect(mockExec).toHaveBeenCalled();
  });
});

describe('parseClaudeAuthStatusOutput', () => {
  it('extracts email and subscription tier from claude auth status json', () => {
    expect(
      parseClaudeAuthStatusOutput(
        JSON.stringify({
          loggedIn: true,
          email: 'vincent@shipshit.dev',
          subscriptionType: 'max',
          authMethod: 'claude.ai',
        }),
      ),
    ).toEqual({
      accountEmail: 'vincent@shipshit.dev',
      loginMethod: 'max',
    });
  });
});

describe('parseClaudeUsageText', () => {
  it('maps session, weekly, and model quotas from claude usage text', () => {
    const status = parseClaudeUsageText(
      `
      Current session
      99% left
      Resets in 4h 49m

      Current week (all models)
      0% left
      Resets in 11h 53m

      Current week (Sonnet)
      46% left
      Resets in 19h 53m
      `,
      '2026-04-16T16:10:00.000Z',
      { accountEmail: 'vincent@shipshit.dev', loginMethod: 'max' },
      '1.0.88',
    );

    expect(status.accountEmail).toBe('vincent@shipshit.dev');
    expect(status.loginMethod).toBe('max');
    expect(status.state).toBe('ready');
    expect(status.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'session', leftPercent: 99 }),
        expect.objectContaining({ key: 'weekly', leftPercent: 0 }),
        expect.objectContaining({ key: 'model', label: 'Sonnet', leftPercent: 46 }),
      ]),
    );
  });

  it('parses new "N% used" format with labels from Claude Code v2.1+', () => {
    const status = parseClaudeUsageText(
      `Current session    70% used  Resets 10am
       Current week (all models) 16% used  Resets Apr 23
       Current week (Sonnet only) 13% used  Resets Apr 23`,
      '2026-04-17T06:00:00.000Z',
      { accountEmail: 'vincent@genfeed.ai', loginMethod: 'max' },
      '2.1.92',
    );

    expect(status.available).toBe(true);
    expect(status.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'session', leftPercent: 30 }),
        expect.objectContaining({ key: 'weekly', leftPercent: 84 }),
        expect.objectContaining({ key: 'model', label: 'Sonnet', leftPercent: 87 }),
      ]),
    );
  });

  it('falls back to status-bar "N% used" when no labels present', () => {
    const status = parseClaudeUsageText(
      `[Opus 4.6] ~/.shipcode/provider-probes/claude | in: 338 / out: 13 | 10% used\n◐ medium · /effort`,
      '2026-04-17T06:00:00.000Z',
      { accountEmail: 'vincent@genfeed.ai', loginMethod: 'max' },
      '2.1.92',
    );

    expect(status.available).toBe(true);
    expect(status.state).toBe('ready');
    expect(status.windows).toEqual([
      expect.objectContaining({ key: 'session', leftPercent: 90, usedPercent: 10 }),
    ]);
  });

  it('returns no-data when output has no recognizable format', () => {
    const status = parseClaudeUsageText('Welcome to Claude Code!\n❯ ', '2026-04-17T06:00:00.000Z');

    expect(status.available).toBe(false);
    expect(status.message).toBe('Claude CLI returned no quota data');
  });

  it('strips parenthetical suffix from version string', () => {
    const withSuffix = parseClaudeUsageText('', undefined, undefined, '2.1.92 (Claude Code)');
    expect(withSuffix.version).toBe('2.1.92');

    const plain = parseClaudeUsageText('', undefined, undefined, '2.1.92');
    expect(plain.version).toBe('2.1.92');

    const noVersion = parseClaudeUsageText('', undefined, undefined, null);
    expect(noVersion.version).toBeNull();
  });
});

describe('parseCodexStatusText', () => {
  it('maps codex status text into session and weekly windows', () => {
    const status = parseCodexStatusText(
      `
      Credits: 54.72
      5h limit 98% left resets 10:55 PM
      Weekly limit 35% left resets in 48m
      `,
      '2026-04-16T16:10:00.000Z',
      '0.121.0',
    );

    expect(status.provider).toBe('codex');
    expect(status.available).toBe(true);
    expect(status.creditsRemaining).toBe(54.72);
    expect(status.windows).toEqual([
      expect.objectContaining({ key: 'session', label: 'Session', leftPercent: 98 }),
      expect.objectContaining({ key: 'weekly', label: 'Weekly', leftPercent: 35 }),
    ]);
  });

  it('maps current boxed codex status text into session and weekly windows', () => {
    const status = parseCodexStatusText(
      `
      │  5h limit:                    [██████████████░░░░░░] 71% left (resets 12:01) │
      │  Weekly limit:                [███████████████░░░░░] 74% left                │
      │                               (resets 21:02 on 28 Apr)                       │
      │  GPT-5.3-Codex-Spark limit:                                                  │
      │  5h limit:                    [████████████████████] 100% left               │
      │                               (resets 15:58)                                 │
      `,
      '2026-04-23T10:15:00.000Z',
      'codex-cli 0.122.0',
    );

    expect(status.available).toBe(true);
    expect(status.version).toBe('0.122.0');
    expect(status.windows).toEqual([
      expect.objectContaining({
        key: 'session',
        label: 'Session',
        leftPercent: 71,
        resetDescription: '12:01',
      }),
      expect.objectContaining({
        key: 'weekly',
        label: 'Weekly',
        leftPercent: 74,
        resetDescription: '21:02 on 28 Apr',
      }),
    ]);
  });

  it('does not let a wrapped codex status row leak into the reset text', () => {
    const status = parseCodexStatusText(
      `
      5h limit: [█████████████░░░░░░░] 66% left (resets 12:01) Weekly limit: [██████████████░░░░░░] 73% left (resets 21:02 on 28 Apr)
      `,
      '2026-04-23T10:15:00.000Z',
      'codex-cli 0.123.0',
    );

    expect(status.windows).toEqual([
      expect.objectContaining({
        key: 'session',
        leftPercent: 66,
        resetDescription: '12:01',
      }),
      expect.objectContaining({
        key: 'weekly',
        leftPercent: 73,
        resetDescription: '21:02 on 28 Apr',
      }),
    ]);
  });

  it('strips binary name prefix from version string', () => {
    const full = parseCodexStatusText('', undefined, 'codex-cli 0.121.0');
    expect(full.version).toBe('0.121.0');

    const plain = parseCodexStatusText('', undefined, '0.121.0');
    expect(plain.version).toBe('0.121.0');

    const noVersion = parseCodexStatusText('', undefined, null);
    expect(noVersion.version).toBeNull();
  });
});

describe('checkCliProviderUsage', () => {
  it('returns parsed direct CLI usage when both providers respond', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'claude --version': { stdout: '1.0.88\n' },
      'codex --version': { stdout: '0.121.0\n' },
      'claude auth status': {
        stdout: JSON.stringify({
          loggedIn: true,
          email: 'vincent@shipshit.dev',
          subscriptionType: 'max',
        }),
      },
    });
    mockPtySpawn.mockImplementation((command: string) => {
      if (command.includes('claude')) {
        return createMockPty(`
          Current session
          99% left
          Resets in 4h 49m

          Current week (all models)
          0% left
          Resets in 11h 53m

          Current week (Sonnet)
          46% left
          Resets in 19h 53m
        `);
      }
      return createMockPty(`
        Credits: 54.72
        5h limit 98% left resets in 4h 49m
        Weekly limit 35% left resets in 48m
      `);
    });

    const result = await checkCliProviderUsage();
    expect(result.claude.accountEmail).toBe('vincent@shipshit.dev');
    expect(result.claude.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'model', label: 'Sonnet', leftPercent: 46 }),
      ]),
    );
    expect(result.codex.creditsRemaining).toBe(54.72);
    expect(result.codex.windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'session', leftPercent: 98 })]),
    );
  });

  it('retries codex status when the CLI refreshes limits on the first request', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'claude --version': { stdout: '1.0.88\n' },
      'codex --version': { stdout: '0.122.0\n' },
      'claude auth status': {
        stdout: JSON.stringify({
          loggedIn: true,
          email: 'vincent@shipshit.dev',
          subscriptionType: 'max',
        }),
      },
    });
    let codexPty!: ReturnType<typeof createCodexRefreshPty>;
    mockPtySpawn.mockImplementation((command: string) => {
      if (command.includes('claude')) {
        return createMockPty(`
          Current session
          99% left
          Resets in 4h 49m
        `);
      }
      codexPty = createCodexRefreshPty();
      return codexPty;
    });

    const resultPromise = checkCliProviderUsage({ force: true });
    await vi.advanceTimersByTimeAsync(1_750);
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await resultPromise;

    const statusWrites = codexPty.write.mock.calls.filter((call) => call[0] === '/status\r');
    expect(statusWrites).toHaveLength(2);
    expect(result.codex.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'session', leftPercent: 88 }),
        expect.objectContaining({ key: 'weekly', leftPercent: 64 }),
      ]),
    );
  });

  it('reuses fresh cached provider usage results until forced', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'claude --version': { stdout: '1.0.88\n' },
      'codex --version': { stdout: '0.121.0\n' },
      'claude auth status': {
        stdout: JSON.stringify({
          loggedIn: true,
          email: 'vincent@shipshit.dev',
          subscriptionType: 'max',
        }),
      },
    });
    mockPtySpawn.mockImplementation((command: string) => {
      if (command.includes('claude')) {
        return createMockPty(`
          Current session
          99% left
          Resets in 4h 49m
        `);
      }
      return createMockPty(`
        Credits: 54.72
        5h limit 98% left resets in 4h 49m
      `);
    });

    const first = await checkCliProviderUsage();
    vi.clearAllMocks();

    const second = await checkCliProviderUsage();
    expect(second).toEqual(first);
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();

    await checkCliProviderUsage({ force: true });
    expect(mockPtySpawn).toHaveBeenCalled();
  });
});

describe('checkOpenRouterAuth', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns missing_key when no API key is provided', async () => {
    const res = await checkOpenRouterAuth(undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('missing_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns missing_key when API key is empty string', async () => {
    const res = await checkOpenRouterAuth('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('missing_key');
  });

  it('returns ok on 200 with label', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { label: 'shipcode-dev' } }), { status: 200 }),
    );
    const res = await checkOpenRouterAuth('sk-or-v1-abc');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.label).toBe('shipcode-dev');
  });

  it('returns invalid_key on 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    const res = await checkOpenRouterAuth('bad-key');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_key');
  });

  it('returns invalid_key on 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const res = await checkOpenRouterAuth('bad-key');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_key');
  });

  it('returns unreachable when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const res = await checkOpenRouterAuth('k');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('unreachable');
      expect(res.message).toContain('ECONNRESET');
    }
  });

  it('warns when pinned model is not in the catalog', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'ok' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 'qwen/qwen3-coder:free' }, { id: 'openrouter/auto' }] }),
          { status: 200 },
        ),
      );

    const res = await checkOpenRouterAuth('k', 'qwen/qwen3.6-plus:free');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('model_deprecated');
  });

  it('returns ok when pinned model IS in the catalog', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'ok' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 'qwen/qwen3-coder:free' }, { id: 'openrouter/auto' }] }),
          { status: 200 },
        ),
      );

    const res = await checkOpenRouterAuth('k', 'openrouter/auto');
    expect(res.ok).toBe(true);
  });
});

describe('checkOpenRouterHealth', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns missing_key health when no API key is available', async () => {
    execFails('not set');
    const result = await checkOpenRouterHealth(settings());
    expect(result.enabled).toBe(false);
    expect(result.authStatus).toBe('missing_key');
  });

  it('verifies configured model slugs when auth succeeds', async () => {
    execRouted({
      'printenv OPENROUTER_API_KEY': { stdout: 'or-key\n' },
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'shipcode-dev' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'openrouter/auto' }, { id: 'anthropic/claude-sonnet-4.6' }],
          }),
          { status: 200 },
        ),
      );

    const result = await checkOpenRouterHealth(
      settings({
        openrouterPlannerModel: 'anthropic/claude-sonnet-4-6',
      }),
    );
    expect(result.authStatus).toBe('valid');
    expect(result.label).toBe('shipcode-dev');
    expect(
      result.modelChecks.find((check: { key: string }) => check.key === 'planner')?.status,
    ).toBe('valid');
  });
});

describe('validateOpenRouterModel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unverified when OpenRouter auth is not ready', async () => {
    execFails('not set');
    const result = await validateOpenRouterModel(settings(), 'openrouter/auto');
    expect(result.status).toBe('unverified');
  });

  it('returns invalid when the model slug is not in the catalog', async () => {
    execRouted({
      'printenv OPENROUTER_API_KEY': { stdout: 'or-key\n' },
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'shipcode-dev' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'openrouter/auto' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'openrouter/auto' }] }), { status: 200 }),
      );

    const result = await validateOpenRouterModel(settings(), 'anthropic/claude-sonnet-4-6');
    expect(result.status).toBe('invalid');
  });
});

describe('checkIntegrationStatus', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns combined CLI, GitHub, and OpenRouter integration data', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'which gemini': { stdout: '/usr/local/bin/gemini\n' },
      'which git': { stdout: '/usr/bin/git\n' },
      'which gh': { stdout: '/usr/local/bin/gh\n' },
      'claude --version': { stdout: 'claude 1.0.0' },
      'codex --version': { stdout: 'codex 0.1.0' },
      'gemini --version': { stdout: '0.1.0' },
      'gemini --help': { stdout: 'Usage: gemini' },
      'git --version': { stdout: 'git version 2.43.0' },
      'gh --version': { stdout: 'gh version 2.40.1' },
      'claude auth status': { stdout: 'Authenticated' },
      'printenv GEMINI_API_KEY': { stdout: 'gemini-key\n' },
      'printenv OPENAI_API_KEY': { stdout: 'sk-key\n' },
      'printenv OPENROUTER_API_KEY': { stdout: 'or-key\n' },
      'gh auth status': {
        stdout:
          "github.com\n  ✓ Logged in to github.com account decod3r (keyring)\n  - Token scopes: 'gist', 'read:org', 'repo', 'workflow', 'project'\n",
      },
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'shipcode-dev' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'openrouter/auto' }] }), { status: 200 }),
      );

    const result = await checkIntegrationStatus(settings());
    expect(result.system.claude.authenticated).toBe(true);
    expect(result.system.codex.authenticated).toBe(true);
    expect(result.system.gemini?.authenticated).toBe(true);
    expect(result.modelCapabilities?.gemini.models.map((model) => model.value)).toContain(
      'gemini-2.5-pro',
    );
    expect(result.ghAuth.authenticated).toBe(true);
    expect(result.openrouter.authStatus).toBe('valid');
    expect(result.discord.validationStatus).toBe('missing');
    expect(result.telegram.validationStatus).toBe('missing');
    expect(result.desktopApps.finder.available).toBe(process.platform === 'darwin');
    expect(result.desktopApps.cursor.available).toBe(false);
  });
});

describe('checkDesktopApps', () => {
  it.skipIf(process.platform !== 'darwin')(
    'detects installed desktop apps and treats Finder and Terminal as available on macOS',
    async () => {
      mockAccess.mockImplementation((path: string) => {
        if (path === '/Applications/Cursor.app') return Promise.resolve();
        if (path === '/Applications/Visual Studio Code.app') return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await checkDesktopApps();
      expect(result.finder.available).toBe(true);
      expect(result.cursor.available).toBe(true);
      expect(result.terminal.available).toBe(true);
      expect(result.ghostty.available).toBe(false);
      expect(result.vscode.available).toBe(true);
      expect(result.t3code.available).toBe(false);
    },
  );
});
