import { CURRENT_ONBOARDING_VERSION, SHIPCODE_DEFAULT_LABELS } from '@shipcode/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

const {
  execMock,
  execFileMock,
  mkdirSyncMock,
  checkSystemHealthMock,
  checkClaudeAuthMock,
  checkCodexAuthMock,
  checkOpenRouterAuthMock,
  parseGhProjectScopeMock,
  getDatabaseMock,
  listProjectsMock,
  addProjectMock,
  updateGitInfoMock,
  settingsSetMock,
  getRemoteUrlMock,
  getDefaultBranchMock,
} = vi.hoisted(() => ({
  execMock: vi.fn(),
  execFileMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  checkSystemHealthMock: vi.fn(),
  checkClaudeAuthMock: vi.fn(),
  checkCodexAuthMock: vi.fn(),
  checkOpenRouterAuthMock: vi.fn(),
  parseGhProjectScopeMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  listProjectsMock: vi.fn(),
  addProjectMock: vi.fn(),
  updateGitInfoMock: vi.fn(),
  settingsSetMock: vi.fn(),
  getRemoteUrlMock: vi.fn(),
  getDefaultBranchMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: execMock,
  execFile: execFileMock,
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: mkdirSyncMock,
  },
}));

vi.mock('@shipcode/agents', () => ({
  checkSystemHealth: checkSystemHealthMock,
  checkClaudeAuth: checkClaudeAuthMock,
  checkCodexAuth: checkCodexAuthMock,
  checkOpenRouterAuth: checkOpenRouterAuthMock,
  parseGhProjectScope: parseGhProjectScopeMock,
}));

vi.mock('@shipcode/db', () => ({
  getDatabase: getDatabaseMock,
  ProjectQueries: class {
    list = listProjectsMock;
    add = addProjectMock;
    updateGitInfo = updateGitInfoMock;
  },
  SettingsQueries: class {
    set = settingsSetMock;
  },
}));

vi.mock('@shipcode/git', () => ({
  GitService: class {
    getRemoteUrl = getRemoteUrlMock;
    getDefaultBranch = getDefaultBranchMock;
  },
}));

import { onboardCommand } from './onboard';

describe('onboardCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOME = '/home/tester';
    delete process.env.OPENROUTER_API_KEY;
    getDatabaseMock.mockReturnValue({});
    checkSystemHealthMock.mockResolvedValue({
      git: { available: true },
      gh: { available: true },
      claude: { available: true },
      codex: { available: true },
    });
    checkClaudeAuthMock.mockResolvedValue(true);
    checkCodexAuthMock.mockResolvedValue(true);
    checkOpenRouterAuthMock.mockResolvedValue({ ok: true, label: 'openrouter/auto' });
    parseGhProjectScopeMock.mockReturnValue(true);
    listProjectsMock.mockReturnValue([]);
    addProjectMock.mockReturnValue({ id: 'project-1' });
    getRemoteUrlMock.mockResolvedValue('git@github.com:shipshitdev/shipcode.git');
    getDefaultBranchMock.mockResolvedValue('main');
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'Token scopes: repo, project', stderr: '' });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(null, { stdout: 'true\n', stderr: '' });
        return;
      }
      if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
        callback(null, { stdout: 'shipshitdev/shipcode\n', stderr: '' });
        return;
      }
      if (cmd === 'gh label list --json name -q ".[].name"') {
        callback(null, {
          stdout: 'shipcode:agent:claude\nshipcode:agent:codex\nshipcode:agent:openrouter\n',
          stderr: '',
        });
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, cb?: unknown) => {
        const callback = (typeof _opts === 'function' ? _opts : cb) as ExecCallback;
        callback(null, { stdout: '', stderr: '' });
      },
    );
  });

  afterAll(() => {
    if (originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
      return;
    }

    process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
  });

  it('fails fast when required CLIs are missing', async () => {
    checkSystemHealthMock.mockResolvedValueOnce({
      git: { available: false },
      gh: { available: false },
      claude: { available: false },
      codex: { available: false },
    });

    await expect(onboardCommand()).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('\n✗ Missing prerequisites:');
    expect(errorSpy).toHaveBeenCalledWith('  - git is not installed');
    expect(errorSpy).toHaveBeenCalledWith('  - gh (GitHub CLI) is not installed');
    expect(errorSpy).toHaveBeenCalledWith('  - claude CLI is not installed');
    expect(errorSpy).toHaveBeenCalledWith('  - codex CLI is not installed');
  });

  it('registers the current repo and prints the ready summary', async () => {
    await onboardCommand();

    const createdLabels = SHIPCODE_DEFAULT_LABELS.length - 3;

    expect(mkdirSyncMock).toHaveBeenCalledWith(expect.stringContaining('.shipcode/data'), {
      recursive: true,
    });
    expect(addProjectMock).toHaveBeenCalledWith(process.cwd());
    expect(updateGitInfoMock).toHaveBeenCalledWith(
      'project-1',
      'git@github.com:shipshitdev/shipcode.git',
      'main',
    );
    expect(settingsSetMock).toHaveBeenCalledWith({
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    });
    expect(logSpy).toHaveBeenCalledWith('  ✓ gh — authenticated (project scope ok)');
    expect(logSpy).toHaveBeenCalledWith('  ✓ codex — authenticated');
    expect(logSpy).toHaveBeenCalledWith('  ⚠ openrouter — OPENROUTER_API_KEY not set (optional)');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  ✓ Created labels:'));
    expect(logSpy).toHaveBeenCalledWith(
      `  ✓ Existing labels kept: ${SHIPCODE_DEFAULT_LABELS.length - createdLabels}`,
    );
    expect(logSpy).toHaveBeenCalledWith('ShipCode is ready!');
    expect(logSpy).toHaveBeenCalledWith('  shipcode run <issue-number>');
  });

  it('creates missing labels and warns when project scope is absent', async () => {
    parseGhProjectScopeMock.mockReturnValueOnce(false);
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'Token scopes: repo', stderr: '' });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(null, { stdout: 'true\n', stderr: '' });
        return;
      }
      if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
        callback(null, { stdout: 'shipshitdev/shipcode\n', stderr: '' });
        return;
      }
      if (cmd === 'gh label list --json name -q ".[].name"') {
        callback(null, { stdout: 'shipcode:agent:claude\n', stderr: '' });
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });

    await onboardCommand();

    expect(logSpy).toHaveBeenCalledWith('  ✓ gh — authenticated');
    expect(logSpy).toHaveBeenCalledWith(
      '  ⚠ gh missing `project` scope — Projects v2 board attach will fail.\n    Fix: gh auth refresh -s project',
    );
    expect(execFileMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  ✓ Created labels:'));
    expect(logSpy).toHaveBeenCalledWith('  ✓ Existing labels kept: 1');
  });

  it('warns when codex CLI is installed but not authenticated', async () => {
    checkCodexAuthMock.mockResolvedValueOnce(false);

    await onboardCommand();

    expect(logSpy).toHaveBeenCalledWith(
      '  ⚠ codex — not authenticated (adversarial review will be skipped). Run: codex login',
    );
  });

  it('fails when gh or claude authentication is missing', async () => {
    execMock.mockImplementationOnce((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(new Error('not logged in'));
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });

    await expect(onboardCommand()).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('\n✗ gh is not authenticated. Run: gh auth login');

    vi.clearAllMocks();
    checkSystemHealthMock.mockResolvedValue({
      git: { available: true },
      gh: { available: true },
      claude: { available: true },
      codex: { available: true },
    });
    parseGhProjectScopeMock.mockReturnValue(null);
    checkClaudeAuthMock.mockResolvedValue(false);
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'authenticated', stderr: '' });
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });

    await expect(onboardCommand()).rejects.toThrow('process.exit:1');
    expect(logSpy).toHaveBeenCalledWith('  ✓ gh — authenticated');
    expect(errorSpy).toHaveBeenCalledWith(
      '\n✗ claude is not authenticated. Check your API key or run: claude auth',
    );
  });

  it('reports OpenRouter authentication warnings for configured API keys', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const seenLogs: string[] = [];

    for (const response of [
      { ok: true, label: 'openrouter/auto' },
      { ok: true, label: null },
      { ok: false, reason: 'invalid_key', message: 'invalid key' },
      { ok: false, reason: 'unreachable', message: 'network unavailable' },
      { ok: false, reason: 'model_deprecated', message: 'model deprecated' },
    ]) {
      vi.clearAllMocks();
      checkSystemHealthMock.mockResolvedValue({
        git: { available: true },
        gh: { available: true },
        claude: { available: true },
        codex: { available: true },
      });
      checkClaudeAuthMock.mockResolvedValue(true);
      checkCodexAuthMock.mockResolvedValue(true);
      checkOpenRouterAuthMock.mockResolvedValueOnce(response);
      parseGhProjectScopeMock.mockReturnValue(null);
      listProjectsMock.mockReturnValue([{ id: 'project-1', path: process.cwd() }]);
      getRemoteUrlMock.mockResolvedValue(null);
      getDefaultBranchMock.mockResolvedValue('trunk');
      execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
        const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
        if (cmd === 'gh auth status 2>&1') {
          callback(null, { stdout: 'authenticated', stderr: '' });
          return;
        }
        if (cmd === 'git rev-parse --is-inside-work-tree') {
          callback(null, { stdout: 'true\n', stderr: '' });
          return;
        }
        if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
          callback(null, { stdout: 'shipshitdev/shipcode\n', stderr: '' });
          return;
        }
        if (cmd === 'gh label list --json name -q ".[].name"') {
          callback(null, {
            stdout: SHIPCODE_DEFAULT_LABELS.map((label) => label.name).join('\n'),
            stderr: '',
          });
          return;
        }
        callback(new Error(`unexpected exec: ${cmd}`));
      });

      await onboardCommand();
      seenLogs.push(...logSpy.mock.calls.map((call) => String(call[0])));
    }

    expect(seenLogs).toContain('  ✓ openrouter — authenticated (openrouter/auto)');
    expect(seenLogs).toContain('  ✓ openrouter — authenticated');
    expect(seenLogs).toContain('  ⚠ openrouter — invalid key');
    expect(seenLogs).toContain('  ⚠ openrouter — network unavailable');
    expect(seenLogs).toContain('  ⚠ openrouter — model deprecated');
    expect(seenLogs).toContain('\n  ✓ Project already registered');
    expect(seenLogs).toContain('  ✓ Remote: none');
    expect(seenLogs).toContain('  ✓ Default branch: trunk');
    expect(seenLogs).toContain('  ✓ All ShipCode labels present');
  });

  it('fails outside git or unresolved GitHub repository context', async () => {
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'authenticated', stderr: '' });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(new Error('not a git repo'));
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });

    await expect(onboardCommand()).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('✗ Not inside a git repository');

    vi.clearAllMocks();
    checkSystemHealthMock.mockResolvedValue({
      git: { available: true },
      gh: { available: true },
      claude: { available: true },
      codex: { available: true },
    });
    checkClaudeAuthMock.mockResolvedValue(true);
    checkCodexAuthMock.mockResolvedValue(true);
    parseGhProjectScopeMock.mockReturnValue(true);
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'Token scopes: repo, project', stderr: '' });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(null, { stdout: 'true\n', stderr: '' });
        return;
      }
      if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
        callback(new Error('no repo'));
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });

    await expect(onboardCommand()).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith(
      '✗ Not a GitHub repository or gh cannot resolve repo context',
    );
  });

  it('continues when label checks or individual label creation fail', async () => {
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'Token scopes: repo, project', stderr: '' });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(null, { stdout: 'true\n', stderr: '' });
        return;
      }
      if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
        callback(null, { stdout: 'shipshitdev/shipcode\n', stderr: '' });
        return;
      }
      if (cmd === 'gh label list --json name -q ".[].name"') {
        callback(new Error('labels unavailable'));
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });

    await onboardCommand();
    expect(logSpy).toHaveBeenCalledWith('  ⚠ Could not check labels');

    vi.clearAllMocks();
    checkSystemHealthMock.mockResolvedValue({
      git: { available: true },
      gh: { available: true },
      claude: { available: true },
      codex: { available: true },
    });
    checkClaudeAuthMock.mockResolvedValue(true);
    checkCodexAuthMock.mockResolvedValue(true);
    parseGhProjectScopeMock.mockReturnValue(true);
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, { stdout: 'Token scopes: repo, project', stderr: '' });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(null, { stdout: 'true\n', stderr: '' });
        return;
      }
      if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
        callback(null, { stdout: 'shipshitdev/shipcode\n', stderr: '' });
        return;
      }
      if (cmd === 'gh label list --json name -q ".[].name"') {
        callback(null, { stdout: 'shipcode:agent:claude\n', stderr: '' });
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });
    execFileMock.mockImplementationOnce(
      (_file: string, _args: string[], _opts: unknown, cb?: unknown) => {
        const callback = (typeof _opts === 'function' ? _opts : cb) as ExecCallback;
        callback('duplicate label' as unknown as Error);
      },
    );

    await onboardCommand();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  ⚠ Failed to create labels:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('unknown error'));
  });

  it('uses a relative data directory when HOME is unavailable', async () => {
    delete process.env.HOME;

    await onboardCommand();

    expect(mkdirSyncMock).toHaveBeenCalledWith('.shipcode/data', { recursive: true });
    expect(getDatabaseMock).toHaveBeenCalledWith('.shipcode/data');
  });

  it('handles sparse auth output, unknown OpenRouter warnings, and all-label creation failures', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    checkOpenRouterAuthMock.mockResolvedValueOnce({
      ok: false,
      reason: 'unknown',
      message: 'ignored warning',
    });
    parseGhProjectScopeMock.mockReturnValueOnce(null);
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
      if (cmd === 'gh auth status 2>&1') {
        callback(null, {} as { stdout: string; stderr: string });
        return;
      }
      if (cmd === 'git rev-parse --is-inside-work-tree') {
        callback(null, { stdout: 'true\n', stderr: '' });
        return;
      }
      if (cmd === 'gh repo view --json nameWithOwner -q .nameWithOwner') {
        callback(null, { stdout: 'shipshitdev/shipcode\n', stderr: '' });
        return;
      }
      if (cmd === 'gh label list --json name -q ".[].name"') {
        callback(null, { stdout: '', stderr: '' });
        return;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
    });
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, cb?: unknown) => {
        const callback = (typeof _opts === 'function' ? _opts : cb) as ExecCallback;
        callback(new Error('create failed\nextra detail'));
      },
    );

    await onboardCommand();

    expect(logSpy).toHaveBeenCalledWith('  ✓ gh — authenticated');
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('ignored warning'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  ⚠ Failed to create labels:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('create failed'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('  ✓ Created labels:'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('  ✓ Existing labels kept:'));
  });
});
