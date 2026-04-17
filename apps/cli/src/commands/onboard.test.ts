import { SHIPCODE_DEFAULT_LABELS } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

const {
  execMock,
  execFileMock,
  mkdirSyncMock,
  checkSystemHealthMock,
  checkClaudeAuthMock,
  checkOpenRouterAuthMock,
  parseGhProjectScopeMock,
  getDatabaseMock,
  listProjectsMock,
  addProjectMock,
  updateGitInfoMock,
  getRemoteUrlMock,
  getDefaultBranchMock,
} = vi.hoisted(() => ({
  execMock: vi.fn(),
  execFileMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  checkSystemHealthMock: vi.fn(),
  checkClaudeAuthMock: vi.fn(),
  checkOpenRouterAuthMock: vi.fn(),
  parseGhProjectScopeMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  listProjectsMock: vi.fn(),
  addProjectMock: vi.fn(),
  updateGitInfoMock: vi.fn(),
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
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getDatabaseMock.mockReturnValue({});
    checkSystemHealthMock.mockResolvedValue({
      git: { available: true },
      gh: { available: true },
      claude: { available: true },
      codex: { available: true },
    });
    checkClaudeAuthMock.mockResolvedValue(true);
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
        callback(null, { stdout: 'agent:claude\nagent:codex\nagent:openrouter\n', stderr: '' });
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

  it('fails fast when required CLIs are missing', async () => {
    checkSystemHealthMock.mockResolvedValueOnce({
      git: { available: false },
      gh: { available: true },
      claude: { available: false },
      codex: { available: true },
    });

    await expect(onboardCommand()).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('\n✗ Missing prerequisites:');
    expect(errorSpy).toHaveBeenCalledWith('  - git is not installed');
    expect(errorSpy).toHaveBeenCalledWith('  - claude CLI is not installed');
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
    expect(logSpy).toHaveBeenCalledWith('  ✓ gh — authenticated (project scope ok)');
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
        callback(null, { stdout: 'agent:claude\n', stderr: '' });
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
});
