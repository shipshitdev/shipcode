import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories, making these available inside them
const {
  mockExec,
  mockExecFile,
  mockExecFileSync,
  mockAccess,
  mockHomedir,
  mockMkdir,
  mockReadFile,
  mockWriteFile,
  mockPtySpawn,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecFile: vi.fn((file: string, args: unknown, opts: unknown, cb?: unknown) => {
    let actualArgs: string[] = [];
    let actualCb = cb;
    if (Array.isArray(args)) {
      actualArgs = args;
    } else if (typeof args === 'function') {
      actualCb = args;
      opts = {};
    } else if (typeof opts === 'function') {
      actualCb = opts;
      opts = args;
    }
    return mockExec([file, ...actualArgs].join(' '), opts, actualCb);
  }),
  mockExecFileSync: vi.fn(),
  mockAccess: vi.fn(),
  mockHomedir: vi.fn(() => '/mock/home'),
  mockMkdir: vi.fn(),
  mockReadFile: vi.fn().mockResolvedValue(''),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockPtySpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: mockExec,
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
}));
vi.mock('node:fs/promises', () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));
vi.mock('node:os', () => ({ homedir: mockHomedir }));
vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));

import { type AppSettings, DEFAULT_SETTINGS } from '@shipcode/shared';
import {
  __resetHealthCheckCachesForTests,
  checkClaudeAuth,
  checkClaudeModelCapabilities,
  checkCliModelCapabilities,
  checkCliProviderUsage,
  checkCodexAuth,
  checkCodexModelCapabilities,
  checkDesktopApps,
  checkGeminiAuth,
  checkGeminiModelCapabilities,
  checkGhAuth,
  checkGrokAuth,
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
  mockReadFile.mockResolvedValue('');
  mockWriteFile.mockResolvedValue(undefined);
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

function createNonExitingPty(text: string, { emitOnWrite = false } = {}) {
  let onData: ((chunk: string) => void) | null = null;
  let onExit: ((event: { exitCode: number }) => void) | null = null;
  let killed = false;
  let flushed = false;

  const flush = () => {
    if (flushed) return;
    flushed = true;
    queueMicrotask(() => {
      if (!killed) onData?.(text);
    });
  };

  return {
    write: vi.fn(() => {
      if (emitOnWrite) flush();
    }),
    kill: vi.fn(() => {
      killed = true;
      onExit?.({ exitCode: 0 });
    }),
    onData: vi.fn((handler: (chunk: string) => void) => {
      onData = handler;
      if (!emitOnWrite) queueMicrotask(() => flush());
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      onExit = handler;
    }),
  };
}

function createSilentPty() {
  return {
    write: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

function createPromptThenUsagePty(promptText: string, usageText: string) {
  let onData: ((chunk: string) => void) | null = null;
  let onExit: ((event: { exitCode: number }) => void) | null = null;
  let killed = false;
  let promptFlushed = false;
  let usageFlushed = false;

  const flushPrompt = () => {
    if (promptFlushed) return;
    promptFlushed = true;
    queueMicrotask(() => {
      if (!killed) onData?.(promptText);
    });
  };

  const flushUsage = () => {
    if (usageFlushed) return;
    usageFlushed = true;
    queueMicrotask(() => {
      if (!killed) onData?.(usageText);
    });
  };

  return {
    write: vi.fn(() => {
      flushUsage();
    }),
    kill: vi.fn(() => {
      killed = true;
      onExit?.({ exitCode: 0 });
    }),
    onData: vi.fn((handler: (chunk: string) => void) => {
      onData = handler;
      flushPrompt();
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      onExit = handler;
    }),
  };
}

function withEnv(overrides: Partial<NodeJS.ProcessEnv>, fn: () => void) {
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  ) as Partial<NodeJS.ProcessEnv>;

  try {
    Object.assign(process.env, overrides);
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('shellExecEnv', () => {
  it('hydrates PATH from the login shell and keeps standard tool locations available', () => {
    withEnv({ BUN_INSTALL: '', SHELL: '/bin/zsh' }, () => {
      mockExecFileSync.mockReturnValue('/shell/bin:/usr/bin\n');

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
    });
  });

  it('falls back to conservative executable paths for untrusted shells', () => {
    withEnv({ BUN_INSTALL: '', SHELL: '/tmp/fake-shell', PATH: '/custom/bin:/usr/bin' }, () => {
      const env = shellExecEnv();

      expect(env.PATH.split(':')).toEqual(
        expect.arrayContaining(['/custom/bin', '/mock/home/.bun/bin', '/opt/homebrew/bin']),
      );
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });

  it('falls back to process PATH when a trusted login shell probe fails', () => {
    withEnv({ BUN_INSTALL: '', SHELL: '/bin/zsh', PATH: '/custom/bin' }, () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('shell failed');
      });

      const env = shellExecEnv();

      expect(env.PATH.split(':')).toEqual(
        expect.arrayContaining(['/custom/bin', '/mock/home/.bun/bin', '/usr/bin']),
      );
    });
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

// ---------------------------------------------------------------------------
// checkGrokAuth
//
// Contract pinned against the real Grok Build CLI: there is NO `grok auth
// status` subcommand (the surface is `grok login` / `grok logout`), so auth is
// detected via env var (`XAI_API_KEY`) or the credential file `~/.grok/auth.json`
// written by `grok login`. Probing a nonexistent subcommand exits non-zero and
// would fail closed even for a logged-in user.
// ---------------------------------------------------------------------------
describe('checkGrokAuth', () => {
  it('returns true when XAI_API_KEY is set', async () => {
    execRouted({ 'printenv XAI_API_KEY': { stdout: 'xai-key\n' } });
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await checkGrokAuth();
    expect(result).toBe(true);
  });

  it('returns true when env var is unset but ~/.grok/auth.json exists', async () => {
    execRouted({ 'printenv XAI_API_KEY': { stdout: '' } });
    mockAccess.mockResolvedValue(undefined);
    const result = await checkGrokAuth();
    expect(result).toBe(true);
  });

  it('returns false when both env var and credential file are absent', async () => {
    execRouted({ 'printenv XAI_API_KEY': { stdout: '' } });
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await checkGrokAuth();
    expect(result).toBe(false);
  });

  it('checks the ~/.grok/auth.json credential path (homedir mocked)', async () => {
    execRouted({ 'printenv XAI_API_KEY': { stdout: '' } });
    mockAccess.mockResolvedValue(undefined);
    await checkGrokAuth();
    expect(mockAccess).toHaveBeenCalledWith('/mock/home/.grok/auth.json');
  });

  it('never probes the nonexistent `grok auth status` subcommand', async () => {
    execRouted({ 'printenv XAI_API_KEY': { stdout: '' } });
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    await checkGrokAuth();
    const invokedGrokAuth = mockExec.mock.calls.some(([cmd]) => String(cmd).includes('grok auth'));
    expect(invokedGrokAuth).toBe(false);
  });
});

describe('parseCodexDebugModels', () => {
  it('maps visible Codex catalog models and supported reasoning efforts', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.4',
            display_name: 'gpt-5.4',
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
    expect(result.models.map((model) => model.label)).toEqual(['GPT-5.4', 'GPT-5.5']);
    expect(result.models[1].supportedReasoningEfforts).toEqual(['low', 'xhigh']);
  });

  it('handles malformed model arrays as an empty catalog', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({ models: { not: 'an array' } }),
      '2026-04-24T00:00:00.000Z',
    );

    expect(result.models).toEqual([]);
    expect(result.source).toBe('catalog');
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

  it('keeps a CLI available when the version command fails', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      '/usr/local/bin/claude --version': new Error('version failed'),
      'which codex': new Error('not found'),
      'which gemini': new Error('not found'),
      'which git': new Error('not found'),
      'which gh': new Error('not found'),
    });

    const result = await checkSystemHealth();
    expect(result.claude).toEqual({
      available: true,
      version: null,
      path: '/usr/local/bin/claude',
      error: null,
      authenticated: false,
    });
  });

  it('treats an empty which result as a missing CLI', async () => {
    execRouted({
      'which claude': { stdout: '' },
      'which codex': new Error('not found'),
      'which gemini': new Error('not found'),
      'which git': new Error('not found'),
      'which gh': new Error('not found'),
    });

    const result = await checkSystemHealth();
    expect(result.claude).toMatchObject({
      available: false,
      path: null,
      error: 'claude not found in PATH',
    });
  });

  it('reuses fresh cached system health and shares in-flight checks', async () => {
    execRouted({
      which: { stdout: '/usr/local/bin/tool\n' },
      '--version': { stdout: 'tool 1.0.0\n' },
    });

    const [first, second] = await Promise.all([checkSystemHealth(), checkSystemHealth()]);
    expect(second).toEqual(first);
    const callsAfterFirstPair = mockExec.mock.calls.length;

    await expect(checkSystemHealth()).resolves.toEqual(first);
    expect(mockExec).toHaveBeenCalledTimes(callsAfterFirstPair);

    await checkSystemHealth({ force: true });
    expect(mockExec.mock.calls.length).toBeGreaterThan(callsAfterFirstPair);
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

  it('detects Gemini auth from GOOGLE_API_KEY and CLI auth status fallback', async () => {
    execRouted({
      'printenv GEMINI_API_KEY': { stdout: '' },
      'printenv GOOGLE_API_KEY': { stdout: 'google-key\n' },
    });
    await expect(checkGeminiAuth()).resolves.toBe(true);

    execRouted({
      'printenv GEMINI_API_KEY': { stdout: '' },
      'printenv GOOGLE_API_KEY': { stdout: '' },
      'gemini auth status': { stdout: 'logged in\n' },
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

  it('shares in-flight authenticated system health checks', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      setTimeout(() => {
        if (cmd.includes('which')) {
          (cb as ExecCallback)(null, { stdout: '/usr/local/bin/tool', stderr: '' });
          return;
        }
        if (cmd.includes('claude auth status')) {
          (cb as ExecCallback)(null, { stdout: 'Authenticated', stderr: '' });
          return;
        }
        if (cmd.includes('printenv OPENAI_API_KEY')) {
          (cb as ExecCallback)(null, { stdout: 'sk-key\n', stderr: '' });
          return;
        }
        if (cmd.includes('printenv GEMINI_API_KEY')) {
          (cb as ExecCallback)(null, { stdout: 'gemini-key\n', stderr: '' });
          return;
        }
        (cb as ExecCallback)(null, { stdout: 'version 1.0', stderr: '' });
      }, 1);
    });

    const [first, second] = await Promise.all([
      checkSystemHealthWithAuth(),
      checkSystemHealthWithAuth(),
    ]);

    expect(second).toEqual(first);
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

  it('falls back to authMethod and ignores malformed auth status json', () => {
    expect(
      parseClaudeAuthStatusOutput(
        JSON.stringify({
          email: '',
          authMethod: 'claude.ai',
        }),
      ),
    ).toEqual({
      accountEmail: null,
      loginMethod: 'claude.ai',
    });
    expect(parseClaudeAuthStatusOutput('not json')).toEqual({
      accountEmail: null,
      loginMethod: null,
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

  it('falls back to ordered percents when labeled Claude output cannot be paired directly', () => {
    const status = parseClaudeUsageText(
      `
      Current session section
      15% used
      Current week section
      25% used
      Current week (Haiku) section
      35% used
      `,
      '2026-04-17T06:00:00.000Z',
    );

    expect(status.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'session', leftPercent: 85 }),
        expect.objectContaining({ key: 'weekly', leftPercent: 65 }),
      ]),
    );
  });

  it('returns no-data when output has no recognizable format', () => {
    const status = parseClaudeUsageText('Welcome to Claude Code!\n❯ ', '2026-04-17T06:00:00.000Z');

    expect(status.available).toBe(false);
    expect(status.message).toBe('Claude CLI returned no quota data');
  });

  it('reports load failures and quota warning/block states', () => {
    expect(
      parseClaudeUsageText('Failed to load usage data', '2026-04-17T06:00:00.000Z').message,
    ).toBe('Claude CLI failed to load usage data');
    expect(
      parseClaudeUsageText('Current session 0% left Resets 10am', '2026-04-17T06:00:00.000Z').state,
    ).toBe('blocked');
    expect(
      parseClaudeUsageText(
        'Current week (Opus) 10% left Resets tomorrow',
        '2026-04-17T06:00:00.000Z',
      ).state,
    ).toBe('warning');
    expect(
      parseClaudeUsageText(
        'Current week (Haiku) 100% used Resets tomorrow',
        '2026-04-17T06:00:00.000Z',
      ).windows,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ leftPercent: 0 })]));
    expect(
      parseClaudeUsageText(
        'Current week (all models) 0% left Resets tomorrow',
        '2026-04-17T06:00:00.000Z',
      ).state,
    ).toBe('blocked');
    expect(
      parseClaudeUsageText('Current week 0% left Resets tomorrow', '2026-04-17T06:00:00.000Z')
        .state,
    ).toBe('blocked');
    expect(
      parseClaudeUsageText(
        'Current session label 101% left\nCurrent week label 101% used\nCurrent week (Opus) label 100% used',
        '2026-04-17T06:00:00.000Z',
      ).windows,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'session', leftPercent: 100 }),
        expect.objectContaining({ key: 'weekly', leftPercent: 0 }),
        expect.objectContaining({ key: 'model', leftPercent: 0 }),
      ]),
    );
  });

  it('strips parenthetical suffix from version string', () => {
    const withSuffix = parseClaudeUsageText('', undefined, undefined, '2.1.92 (Claude Code)');
    expect(withSuffix.version).toBe('2.1.92');

    const plain = parseClaudeUsageText('', undefined, undefined, '2.1.92');
    expect(plain.version).toBe('2.1.92');

    const noVersion = parseClaudeUsageText('', undefined, undefined, null);
    expect(noVersion.version).toBeNull();
  });

  it('clamps status-bar usage and preserves non-semver Claude versions', () => {
    const status = parseClaudeUsageText('final 999% used', undefined, undefined, 'dev');

    expect(status.version).toBe('dev');
    expect(status.state).toBe('blocked');
    expect(status.windows).toEqual([
      expect.objectContaining({ key: 'session', leftPercent: 0, usedPercent: 100 }),
    ]);
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

  it('parses international numeric formats and quota states', () => {
    const blocked = parseCodexStatusText(
      `
      Credits: 0
      Weekly limit 0% left resets tomorrow
      `,
      '2026-04-16T16:10:00.000Z',
      'codex custom-version',
    );
    expect(blocked.version).toBe('codex custom-version');
    expect(blocked.state).toBe('blocked');

    const commaDecimal = parseCodexStatusText(`
      Credits: 1.234,50
      5h limit 12% left resets soon
    `);
    expect(commaDecimal.creditsRemaining).toBe(1234.5);
    expect(commaDecimal.state).toBe('warning');

    expect(parseCodexStatusText('Credits: 1,234.50\n').creditsRemaining).toBe(1234.5);
    expect(parseCodexStatusText('Credits: 1,5\n').creditsRemaining).toBe(1.5);
    expect(parseCodexStatusText('Credits: 1,234\n').creditsRemaining).toBe(1234);
    expect(parseCodexStatusText('Credits: 1.234\n').creditsRemaining).toBe(1234);
  });

  it('reports no-data when codex status output has no quota content', () => {
    const status = parseCodexStatusText('Welcome to Codex');
    expect(status.available).toBe(false);
    expect(status.state).toBe('unknown');
    expect(status.message).toBe('Codex CLI returned no quota data');
    expect(parseCodexStatusText('Credits: nope\n5h limit left').creditsRemaining).toBeNull();
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

  it('blocks on exhausted session quota and keeps ready weekly quota without credits', () => {
    expect(parseCodexStatusText('5h limit 0% left resets soon').state).toBe('blocked');
    expect(parseCodexStatusText('Weekly limit 0% left resets next week').state).toBe('blocked');

    const ready = parseCodexStatusText('Weekly limit 100% left resets next week');
    expect(ready.state).toBe('ready');
    expect(ready.creditsRemaining).toBeNull();

    const exhaustedWithCredits = parseCodexStatusText('Credits: 10\nWeekly limit 0% left');
    expect(exhaustedWithCredits.state).toBe('warning');
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

  it('returns unavailable provider usage when CLIs are missing', async () => {
    execFails('not found');

    const result = await checkCliProviderUsage({ force: true });
    expect(result.claude).toMatchObject({
      available: false,
      source: null,
      message: 'claude CLI not found in PATH',
      windows: [],
    });
    expect(result.codex).toMatchObject({
      available: false,
      source: null,
      message: 'codex CLI not found in PATH',
      windows: [],
    });
  });

  it('returns unavailable provider usage when probes fail without cached data', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'claude --version': { stdout: '1.0.88\n' },
      'codex --version': { stdout: '0.121.0\n' },
      'claude auth status': new Error('auth unavailable'),
    });
    mockPtySpawn.mockImplementation(() => {
      throw new Error('pty unavailable');
    });

    const result = await checkCliProviderUsage({ force: true });
    expect(result.claude).toMatchObject({
      available: false,
      stale: false,
    });
    expect(result.claude.message).toContain('Claude CLI usage unavailable: pty unavailable');
    expect(result.codex.message).toContain('Codex CLI usage unavailable: pty unavailable');
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

  it('shares in-flight provider usage probes', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      setTimeout(() => {
        if (cmd.includes('which claude')) {
          (cb as ExecCallback)(null, { stdout: '/usr/local/bin/claude\n', stderr: '' });
          return;
        }
        if (cmd.includes('which codex')) {
          (cb as ExecCallback)(null, { stdout: '/usr/local/bin/codex\n', stderr: '' });
          return;
        }
        if (cmd.includes('claude auth status')) {
          (cb as ExecCallback)(null, { stdout: '{"email":"vincent@shipshit.dev"}', stderr: '' });
          return;
        }
        (cb as ExecCallback)(null, { stdout: '1.0.0\n', stderr: '' });
      }, 1);
    });
    mockPtySpawn.mockImplementation((command: string) =>
      command.includes('claude')
        ? createMockPty('Current session 99% left')
        : createMockPty('Credits: 54.72\n5h limit 98% left resets soon'),
    );

    const [first, second] = await Promise.all([
      checkCliProviderUsage({ force: true }),
      checkCliProviderUsage({ force: true }),
    ]);

    expect(second).toEqual(first);
  });

  it('returns stale cached provider usage when a forced refresh fails', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'claude --version': { stdout: '1.0.88\n' },
      'codex --version': { stdout: '0.121.0\n' },
      'claude auth status': { stdout: '{"email":"vincent@shipshit.dev"}' },
    });
    mockPtySpawn.mockImplementation((command: string) =>
      command.includes('claude')
        ? createMockPty('Current session 99% left')
        : createMockPty('Credits: 54.72\n5h limit 98% left resets soon'),
    );
    const first = await checkCliProviderUsage();

    mockPtySpawn.mockImplementation(() => {
      throw new Error('pty unavailable');
    });
    const stale = await checkCliProviderUsage({ force: true });

    expect(stale.claude).toMatchObject({
      stale: true,
      windows: first.claude.windows,
    });
    expect(stale.codex).toMatchObject({
      stale: true,
      creditsRemaining: 54.72,
    });
  });

  it('parses Claude usage even when auth details cannot be read', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': new Error('not found'),
      'claude --version': { stdout: '1.0.88\n' },
      'claude auth status': new Error('auth unavailable'),
    });
    mockPtySpawn.mockReturnValue(createMockPty('Current session 88% left'));

    const result = await checkCliProviderUsage({ force: true });
    expect(result.claude).toMatchObject({
      available: true,
      accountEmail: null,
      loginMethod: null,
    });
    expect(result.claude.windows).toEqual([
      expect.objectContaining({ key: 'session', leftPercent: 88 }),
    ]);
  });

  it('settles a Claude usage probe after stop text even when the PTY stays open', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': new Error('not found'),
      'claude --version': { stdout: '1.0.88\n' },
      'claude auth status': new Error('auth unavailable'),
    });
    const claudePty = createNonExitingPty('Current session 77% left');
    mockPtySpawn.mockReturnValue(claudePty);

    const resultPromise = checkCliProviderUsage({ force: true });
    await vi.advanceTimersByTimeAsync(800);
    const result = await resultPromise;

    expect(claudePty.kill).toHaveBeenCalled();
    expect(result.claude.windows).toEqual([
      expect.objectContaining({ key: 'session', leftPercent: 77 }),
    ]);
  });

  it('reports a timed out Claude usage probe when the PTY never emits output', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': new Error('not found'),
      'claude --version': { stdout: '1.0.88\n' },
      'claude auth status': new Error('auth unavailable'),
    });
    const claudePty = createSilentPty();
    mockPtySpawn.mockReturnValue(claudePty);

    const resultPromise = checkCliProviderUsage({ force: true });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await resultPromise;

    expect(claudePty.kill).toHaveBeenCalled();
    expect(result.claude.available).toBe(false);
    expect(result.claude.message).toContain(
      'Claude CLI usage unavailable: /usr/local/bin/claude usage probe timed out',
    );
  });

  it('finishes an idle Codex probe with partial output and no exit event', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': new Error('not found'),
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'codex --version': { stdout: '0.121.0\n' },
    });
    const codexPty = createNonExitingPty('Codex is ready', { emitOnWrite: true });
    mockPtySpawn.mockReturnValue(codexPty);

    const resultPromise = checkCliProviderUsage({ force: true });
    await vi.advanceTimersByTimeAsync(1_750);
    await vi.advanceTimersByTimeAsync(4_050);
    const result = await resultPromise;

    expect(codexPty.kill).toHaveBeenCalled();
    expect(result.codex).toMatchObject({
      available: false,
      message: 'Codex CLI returned no quota data',
    });
  });

  it('returns partial Claude output at the hard timeout when the probe never reaches stop text', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': new Error('not found'),
      'claude --version': { stdout: '1.0.88\n' },
      'claude auth status': new Error('auth unavailable'),
    });
    const claudePty = createNonExitingPty('Claude Code is starting');
    mockPtySpawn.mockReturnValue(claudePty);

    const resultPromise = checkCliProviderUsage({ force: true });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await resultPromise;

    expect(claudePty.kill).toHaveBeenCalled();
    expect(result.claude).toMatchObject({
      available: false,
      message: 'Claude CLI returned no quota data',
    });
  });

  it('responds to immediate Claude trust prompts before reading usage output', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': new Error('not found'),
      'claude --version': { stdout: '1.0.88\n' },
      'claude auth status': new Error('auth unavailable'),
    });
    const claudePty = createPromptThenUsagePty('Quick safety check:', 'Current session 66% left');
    mockPtySpawn.mockReturnValue(claudePty);

    const resultPromise = checkCliProviderUsage({ force: true });
    await vi.advanceTimersByTimeAsync(800);
    const result = await resultPromise;

    expect(claudePty.write).toHaveBeenCalledWith('\r');
    expect(result.claude.windows).toEqual([
      expect.objectContaining({ key: 'session', leftPercent: 66 }),
    ]);
  });

  it('clears pending delayed Codex retry sends when stop text arrives first', async () => {
    vi.useFakeTimers();
    execRouted({
      'which claude': new Error('not found'),
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'codex --version': { stdout: '0.121.0\n' },
    });
    const codexPty = createNonExitingPty(
      'refresh requested\nCredits: 2\n5h limit 98% left resets soon',
      { emitOnWrite: true },
    );
    mockPtySpawn.mockReturnValue(codexPty);

    const resultPromise = checkCliProviderUsage({ force: true });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_750);
    await vi.advanceTimersByTimeAsync(550);
    const result = await resultPromise;
    await vi.advanceTimersByTimeAsync(1_500);

    expect(result.codex.creditsRemaining).toBe(2);
    expect(codexPty.write).toHaveBeenCalledWith('\r');
    expect(codexPty.write).not.toHaveBeenCalledWith('/status\r');
  });

  it('does not rewrite Codex trust config when the probe directory is already trusted', async () => {
    execRouted({
      'which claude': new Error('not found'),
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'codex --version': { stdout: '0.121.0\n' },
    });
    mockReadFile.mockResolvedValue(
      '[projects."/mock/home/.shipcode/provider-probes/codex"]\ntrust_level = "trusted"\n',
    );
    mockPtySpawn.mockReturnValue(createMockPty('Credits: 1\n5h limit 99% left'));

    const result = await checkCliProviderUsage({ force: true });

    expect(result.codex.creditsRemaining).toBe(1);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('creates Codex trust config when the config file cannot be read', async () => {
    execRouted({
      'which claude': new Error('not found'),
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'codex --version': { stdout: '0.121.0\n' },
    });
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockPtySpawn.mockReturnValue(createMockPty('Credits: 1\n5h limit 99% left'));

    const result = await checkCliProviderUsage({ force: true });

    expect(result.codex.creditsRemaining).toBe(1);
    expect(mockMkdir).toHaveBeenCalledWith('/mock/home/.codex', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/home/.codex/config.toml',
      '\n[projects."/mock/home/.shipcode/provider-probes/codex"]\ntrust_level = "trusted"\n',
    );
  });
});

describe('CLI model capabilities', () => {
  it('parses sparse Codex catalog entries with fallback labels and efforts', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({
        models: [
          {
            slug: ' custom-model ',
            display_name: ' ',
            description: ' ',
            supported_reasoning_levels: 'bad-shape',
            default_reasoning_level: 'bad-effort',
            visibility: 'list',
          },
          {
            slug: 'display-model',
            display_name: 'Display Model',
            description: '',
            supported_reasoning_levels: [{ effort: 'medium' }],
            default_reasoning_level: 'medium',
            visibility: 'list',
          },
          { slug: 123, visibility: 'list' },
        ],
      }),
      '2026-04-24T00:00:00.000Z',
    );

    expect(result.models).toEqual([
      expect.objectContaining({
        value: 'custom-model',
        label: 'custom-model',
        description: null,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      }),
      expect.objectContaining({
        value: 'display-model',
        label: 'Display Model',
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['medium'],
      }),
    ]);
  });

  it('falls back when the Codex catalog is empty or malformed', async () => {
    execRouted({
      'codex debug models': { stdout: JSON.stringify({ models: [] }) },
    });
    const empty = await checkCodexModelCapabilities();
    expect(empty.source).toBe('fallback');
    expect(empty.error).toContain('returned no selectable models');

    __resetHealthCheckCachesForTests();
    execRouted({
      'codex debug models': { stdout: 'not-json' },
    });
    const malformed = await checkCodexModelCapabilities();
    expect(malformed.source).toBe('fallback');
    expect(malformed.error).toContain('Codex model catalog unavailable');
  });

  it('reports Claude model capabilities as unavailable when the CLI probe fails', async () => {
    execRouted({
      'claude --help': new Error('claude missing'),
    });

    const result = await checkClaudeModelCapabilities();
    expect(result).toMatchObject({
      provider: 'claude',
      source: 'unavailable',
      models: [],
    });
    expect(result.error).toContain('claude missing');
  });

  it('reports Gemini model capabilities as unavailable when the CLI probe fails', async () => {
    execRouted({
      'gemini --help': new Error('gemini missing'),
    });

    const result = await checkGeminiModelCapabilities();
    expect(result).toMatchObject({
      provider: 'gemini',
      source: 'unavailable',
      models: [],
    });
    expect(result.error).toContain('gemini missing');
  });

  it('uses generic catalog failure text for non-Error and empty errors', async () => {
    mockExec.mockImplementation((_cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
      }
      (cb as ExecCallback)('plain failure' as unknown as Error);
    });

    const nonError = await checkClaudeModelCapabilities();
    expect(nonError.error).toContain('usage data unavailable');

    __resetHealthCheckCachesForTests();
    mockExec.mockImplementation((_cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
      }
      (cb as ExecCallback)(new Error('   '));
    });

    const emptyError = await checkGeminiModelCapabilities();
    expect(emptyError.error).toContain('usage data unavailable');
  });

  it('caches combined CLI model capabilities until forced', async () => {
    execRouted({
      'claude --help': { stdout: 'Usage: claude' },
      'gemini --help': { stdout: 'Usage: gemini' },
      'codex debug models': {
        stdout: JSON.stringify({
          models: [{ slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' }],
        }),
      },
    });

    const first = await checkCliModelCapabilities();
    vi.clearAllMocks();

    await expect(checkCliModelCapabilities()).resolves.toEqual(first);
    expect(mockExec).not.toHaveBeenCalled();

    await checkCliModelCapabilities({ force: true });
    expect(mockExec).toHaveBeenCalled();
  });

  it('shares in-flight CLI model capability checks', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      setTimeout(() => {
        if (cmd.includes('codex debug models')) {
          (cb as ExecCallback)(null, {
            stdout: JSON.stringify({
              models: [{ slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' }],
            }),
            stderr: '',
          });
          return;
        }
        (cb as ExecCallback)(null, { stdout: 'Usage', stderr: '' });
      }, 1);
    });

    const [first, second] = await Promise.all([
      checkCliModelCapabilities(),
      checkCliModelCapabilities(),
    ]);

    expect(second).toEqual(first);
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

  it('returns generic unreachable text when fetch throws a non-Error value', async () => {
    fetchMock.mockRejectedValueOnce('offline');

    const res = await checkOpenRouterAuth('k');

    expect(res).toEqual({
      ok: false,
      reason: 'unreachable',
      message: 'OpenRouter unreachable',
    });
  });

  it('returns unreachable on non-auth HTTP errors and tolerates malformed auth JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    const error = await checkOpenRouterAuth('key');
    expect(error.ok).toBe(false);
    if (!error.ok) {
      expect(error.reason).toBe('unreachable');
      expect(error.message).toContain('HTTP 500');
    }

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    const ok = await checkOpenRouterAuth('key');
    expect(ok).toEqual({ ok: true, label: undefined });
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

  it('keeps auth valid when pinned model catalog fetch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'shipcode-dev' } }), { status: 200 }),
      )
      .mockRejectedValueOnce(new Error('catalog down'));

    const res = await checkOpenRouterAuth('k', 'openrouter/auto');
    expect(res).toEqual({ ok: true, label: 'shipcode-dev' });
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

  it('falls back to process.env when printenv cannot read the OpenRouter key', async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'env-or-key';
    execFails('printenv unavailable');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: 'env-key' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    try {
      const result = await checkOpenRouterHealth(settings());
      expect(result.authStatus).toBe('valid');
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer env-or-key');
    } finally {
      if (previous === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previous;
      }
    }
  });

  it('reports invalid and unreachable OpenRouter health states', async () => {
    execRouted({
      'printenv OPENROUTER_API_KEY': { stdout: 'or-key\n' },
    });
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const invalid = await checkOpenRouterHealth(settings());
    expect(invalid.authStatus).toBe('invalid_key');
    expect(
      invalid.modelChecks
        .filter((check) => check.modelId)
        .every((check) => check.status === 'unverified'),
    ).toBe(true);

    __resetHealthCheckCachesForTests();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const unreachable = await checkOpenRouterHealth(settings());
    expect(unreachable.authStatus).toBe('unreachable');
  });

  it('marks configured OpenRouter models unverified when the catalog cannot be fetched', async () => {
    execRouted({
      'printenv OPENROUTER_API_KEY': { stdout: 'or-key\n' },
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response('down', { status: 500 }));

    const result = await checkOpenRouterHealth(
      settings({ openrouterExecutorModel: 'openrouter/auto' }),
    );

    expect(result.authStatus).toBe('valid');
    expect(result.label).toBeNull();
    expect(result.message).toBe('Authenticated, but OpenRouter model catalog could not be fetched');
    expect(result.modelChecks.find((check) => check.key === 'executor')).toMatchObject({
      modelId: 'openrouter/auto',
      status: 'unverified',
    });
  });

  it('marks configured OpenRouter models unverified when catalog fetch throws', async () => {
    execRouted({
      'printenv OPENROUTER_API_KEY': { stdout: 'or-key\n' },
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }))
      .mockRejectedValueOnce(new Error('catalog offline'));

    const result = await checkOpenRouterHealth(
      settings({ openrouterReviewerModel: 'openrouter/auto' }),
    );

    expect(result.authStatus).toBe('valid');
    expect(result.modelChecks.find((check) => check.key === 'reviewer')).toMatchObject({
      modelId: 'openrouter/auto',
      status: 'unverified',
    });
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

  it('returns unverified for empty model slugs and unreachable catalogs', async () => {
    const empty = await validateOpenRouterModel(settings(), '   ');
    expect(empty).toEqual({
      modelId: '',
      status: 'unverified',
      message: 'Model slug is required',
    });

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
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));

    const result = await validateOpenRouterModel(settings(), 'openrouter/auto');
    expect(result.status).toBe('unverified');
    expect(result.message).toBe('OpenRouter model catalog could not be fetched');
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

  it('returns valid when the model slug is in the catalog', async () => {
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

    const result = await validateOpenRouterModel(settings(), 'openrouter/auto');
    expect(result).toEqual({ modelId: 'openrouter/auto', status: 'valid', message: null });
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

  it('validates chat integrations and reuses matching cached integration status', async () => {
    execRouted({
      'which claude': { stdout: '/usr/local/bin/claude\n' },
      'which codex': { stdout: '/usr/local/bin/codex\n' },
      'which gemini': { stdout: '/usr/local/bin/gemini\n' },
      'which git': { stdout: '/usr/bin/git\n' },
      'which gh': { stdout: '/usr/local/bin/gh\n' },
      'claude --version': { stdout: 'claude 1.0.0' },
      'codex --version': { stdout: 'codex 0.1.0' },
      'gemini --version': { stdout: '0.1.0' },
      'git --version': { stdout: 'git version 2.43.0' },
      'gh --version': { stdout: 'gh version 2.40.1' },
      'claude --help': { stdout: 'Usage: claude' },
      'gemini --help': { stdout: 'Usage: gemini' },
      'codex debug models': {
        stdout: JSON.stringify({
          models: [{ slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' }],
        }),
      },
      'claude auth status': { stdout: 'Authenticated' },
      'printenv OPENAI_API_KEY': { stdout: 'sk-key\n' },
      'printenv GEMINI_API_KEY': { stdout: 'gemini-key\n' },
      'printenv OPENROUTER_API_KEY': { stdout: '' },
      'gh auth status': { stdout: 'Logged in to github.com account decod3r' },
    });
    const withChat = settings({
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/id/token',
      discordLastDeliveryStatus: {
        provider: 'discord',
        destination: 'https://discord.com/api/webhooks/id/token',
        lastAttemptAt: '2026-05-09T00:00:00.000Z',
        lastSuccessAt: '2026-05-09T00:00:00.000Z',
        lastError: null,
      },
      telegramEnabled: true,
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwxyz',
      telegramDefaultChatId: 'shipcode',
      telegramLastDeliveryStatus: {
        provider: 'telegram',
        destination: 'shipcode',
        lastAttemptAt: '2026-05-09T00:00:00.000Z',
        lastSuccessAt: null,
        lastError: 'delivery failed',
      },
    });

    const first = await checkIntegrationStatus(withChat);
    expect(first.discord).toMatchObject({
      configured: true,
      validationStatus: 'valid',
      lastDeliveryStatus: {
        provider: 'discord',
        destination: 'https://discord.com/api/webhooks/id/token',
        lastAttemptAt: '2026-05-09T00:00:00.000Z',
        lastSuccessAt: '2026-05-09T00:00:00.000Z',
        lastError: null,
      },
    });
    expect(first.telegram).toMatchObject({
      configured: true,
      destinationConfigured: true,
      validationStatus: 'valid',
      lastDeliveryStatus: {
        provider: 'telegram',
        destination: 'shipcode',
        lastAttemptAt: '2026-05-09T00:00:00.000Z',
        lastSuccessAt: null,
        lastError: 'delivery failed',
      },
    });

    vi.clearAllMocks();
    await expect(checkIntegrationStatus(withChat)).resolves.toEqual(first);
    expect(mockExec).not.toHaveBeenCalled();

    const invalidChat = await checkIntegrationStatus(
      settings({
        discordEnabled: true,
        discordWebhookUrl: 'not-a-webhook',
        telegramEnabled: true,
        telegramBotToken: 'bad-token',
        telegramDefaultChatId: 'shipcode',
      }),
      { force: true },
    );
    expect(invalidChat.discord.validationStatus).toBe('invalid');
    expect(invalidChat.telegram.validationStatus).toBe('invalid');

    const missingTelegramChat = await checkIntegrationStatus(
      settings({
        telegramEnabled: true,
        telegramBotToken: '123456:abcdefghijklmnopqrstuvwxyz',
        telegramDefaultChatId: '   ',
      }),
      { force: true },
    );
    expect(missingTelegramChat.telegram).toMatchObject({
      configured: false,
      destinationConfigured: false,
      validationStatus: 'missing',
      message: 'Telegram default chat ID is not configured',
    });
  });

  it('shares in-flight integration status checks', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
      }
      setTimeout(() => {
        if (cmd.includes('which')) {
          (cb as ExecCallback)(null, { stdout: '/usr/local/bin/tool\n', stderr: '' });
          return;
        }
        if (cmd.includes('printenv OPENROUTER_API_KEY')) {
          (cb as ExecCallback)(null, { stdout: '', stderr: '' });
          return;
        }
        if (cmd.includes('gh auth status')) {
          (cb as ExecCallback)(null, { stdout: 'Logged in to github.com account decod3r' });
          return;
        }
        (cb as ExecCallback)(null, { stdout: 'Usage', stderr: '' });
      }, 1);
    });

    const [first, second] = await Promise.all([
      checkIntegrationStatus(settings(), { force: true }),
      checkIntegrationStatus(settings(), { force: true }),
    ]);

    expect(second).toEqual(first);
  });
});

describe('checkDesktopApps', () => {
  it('reports desktop apps unavailable on non-macOS platforms', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux',
    });

    try {
      const result = await checkDesktopApps();
      expect(result.cursor).toMatchObject({
        available: false,
        error: 'Desktop app detection is currently macOS-only',
      });
      expect(result.finder.available).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it('detects macOS desktop app paths when platform is darwin', async () => {
    const originalPlatform = process.platform;
    const previousHome = process.env.HOME;
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });
    process.env.HOME = '/Users/vincent';
    mockAccess.mockImplementation((path: string) => {
      if (path === '/Applications/Cursor.app') return Promise.resolve();
      if (path === '/Users/vincent/Applications/Ghostty.app') return Promise.resolve();
      return Promise.reject(new Error('ENOENT'));
    });

    try {
      const result = await checkDesktopApps();

      expect(result.finder).toMatchObject({
        available: true,
        path: '/System/Library/CoreServices/Finder.app',
      });
      expect(result.terminal.available).toBe(true);
      expect(result.cursor.path).toBe('/Applications/Cursor.app');
      expect(result.ghostty.path).toBe('/Users/vincent/Applications/Ghostty.app');
      expect(result.vscode.available).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform,
      });
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  it.skipIf(process.platform !== 'darwin')(
    'detects apps installed in the user Applications folder',
    async () => {
      const previousHome = process.env.HOME;
      process.env.HOME = '/Users/vincent';
      mockAccess.mockImplementation((path: string) => {
        if (path === '/Users/vincent/Applications/Ghostty.app') return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });

      try {
        const result = await checkDesktopApps();
        expect(result.ghostty).toMatchObject({
          available: true,
          path: '/Users/vincent/Applications/Ghostty.app',
        });
      } finally {
        if (previousHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = previousHome;
        }
      }
    },
  );

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
