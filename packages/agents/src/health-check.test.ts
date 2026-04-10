import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before vi.mock factories, making these available inside them
const { mockExec, mockAccess, mockHomedir } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockAccess: vi.fn(),
  mockHomedir: vi.fn(() => '/mock/home'),
}));

vi.mock('node:child_process', () => ({ exec: mockExec }));
vi.mock('node:fs/promises', () => ({ access: mockAccess }));
vi.mock('node:os', () => ({ homedir: mockHomedir }));

import {
  checkClaudeAuth,
  checkCodexAuth,
  checkGhAuth,
  checkOpenRouterAuth,
  checkSystemHealth,
  checkSystemHealthWithAuth,
} from './health-check';

// Helper: make mockExec resolve with given stdout/stderr
function execSucceeds(stdout = '', stderr = '') {
  mockExec.mockImplementation((_cmd: string, opts: unknown, cb?: unknown) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    (cb as Function)(null, { stdout, stderr });
  });
}

// Helper: make mockExec reject with an error
function execFails(message = 'command failed') {
  mockExec.mockImplementation((_cmd: string, opts: unknown, cb?: unknown) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    (cb as Function)(new Error(message));
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
          (cb as Function)(result);
        } else {
          (cb as Function)(null, {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
          });
        }
        return;
      }
    }
    (cb as Function)(new Error(`unmatched command: ${cmd}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockRejectedValue(new Error('ENOENT'));
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
});

// ---------------------------------------------------------------------------
// checkSystemHealth
// ---------------------------------------------------------------------------
describe('checkSystemHealth', () => {
  it('returns all 4 CLIs with correct availability', async () => {
    execRouted({
      which: { stdout: '/usr/local/bin/tool\n' },
      'claude --version': { stdout: 'claude 1.0.0' },
      'codex --version': { stdout: 'codex 0.1.0' },
      'git --version': { stdout: 'git version 2.43.0' },
      'gh --version': { stdout: 'gh version 2.40.1 (2024-01-01)' },
    });

    const result = await checkSystemHealth();
    expect(result.claude.available).toBe(true);
    expect(result.codex.available).toBe(true);
    expect(result.git.available).toBe(true);
    expect(result.gh.available).toBe(true);
  });

  it('handles mixed availability (some available, some not)', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      // git and gh are available, claude and codex are not
      if (cmd.includes('which git') || cmd.includes('which gh')) {
        (cb as Function)(null, { stdout: '/usr/bin/tool', stderr: '' });
      } else if (cmd.includes('which claude') || cmd.includes('which codex')) {
        (cb as Function)(new Error('not found'));
      } else if (cmd.startsWith('git') || cmd.startsWith('gh')) {
        (cb as Function)(null, { stdout: 'version info', stderr: '' });
      } else {
        (cb as Function)(new Error('not found'));
      }
    });

    const result = await checkSystemHealth();
    expect(result.claude.available).toBe(false);
    expect(result.codex.available).toBe(false);
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
        (cb as Function)(null, { stdout: '/usr/local/bin/tool', stderr: '' });
      } else if (cmd.includes('claude auth status')) {
        (cb as Function)(null, { stdout: 'Authenticated', stderr: '' });
      } else if (cmd.includes('printenv OPENAI_API_KEY')) {
        (cb as Function)(null, { stdout: 'sk-key', stderr: '' });
      } else {
        (cb as Function)(null, { stdout: 'version 1.0', stderr: '' });
      }
    });

    const result = await checkSystemHealthWithAuth();
    expect(result.claude.available).toBe(true);
    expect(result.claude.authenticated).toBe(true);
    expect(result.codex.available).toBe(true);
    expect(result.codex.authenticated).toBe(true);
  });

  it('sets authenticated=false when CLI available but auth fails', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (cmd.includes('which')) {
        (cb as Function)(null, { stdout: '/usr/local/bin/tool', stderr: '' });
      } else if (cmd.includes('claude auth status')) {
        (cb as Function)(new Error('not authenticated'));
      } else if (cmd.includes('printenv OPENAI_API_KEY')) {
        (cb as Function)(new Error('not set'));
      } else {
        (cb as Function)(null, { stdout: 'version 1.0', stderr: '' });
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
