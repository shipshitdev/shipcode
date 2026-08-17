import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { generateCommitGroups } from '@shipcode/agents';
import { type CleanupItem, DEFAULT_SETTINGS, type Project } from '@shipcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listPullRequestsMock } = vi.hoisted(() => ({
  listPullRequestsMock: vi.fn<
    () => Promise<
      Array<{
        number: number;
        url: string;
        state: 'MERGED' | 'CLOSED' | 'OPEN';
        headRefName: string;
      }>
    >
  >(async () => []),
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    listPullRequests = listPullRequestsMock;
  },
  generateCommitGroups: vi.fn(),
}));

vi.mock('./logger.service', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const execFileAsync = promisify(execFile);

let tempRoot: string | null = null;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function gitCan(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function makeProject(repoPath: string): Project {
  const now = '2026-05-08T00:00:00.000Z';
  return {
    id: 'project-1',
    name: 'Cleanup Test',
    path: repoPath,
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
    createdAt: now,
    updatedAt: now,
  };
}

async function writeAndCommit(
  repoPath: string,
  fileName: string,
  content: string,
  message: string,
) {
  fs.writeFileSync(path.join(repoPath, fileName), content);
  await git(repoPath, ['add', fileName]);
  await git(repoPath, ['commit', '-m', message]);
}

async function createFixtureRepo() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-cleanup-'));
  const remotePath = path.join(tempRoot, 'origin.git');
  const repoPath = path.join(tempRoot, 'repo');
  const worktreePath = path.join(tempRoot, 'worktree-shipcode-12-done');

  fs.mkdirSync(repoPath);
  await execFileAsync('git', ['init', '--bare', remotePath]);
  await execFileAsync('git', ['init', '--initial-branch=main', repoPath]);
  await git(repoPath, ['config', 'user.email', 'shipcode@example.test']);
  await git(repoPath, ['config', 'user.name', 'ShipCode Test']);
  await git(repoPath, ['remote', 'add', 'origin', remotePath]);

  await writeAndCommit(repoPath, 'README.md', 'initial\n', 'initial commit');
  await git(repoPath, ['push', '-u', 'origin', 'main']);

  await git(repoPath, ['checkout', '-b', 'shipcode/12-done']);
  await writeAndCommit(repoPath, 'done.txt', 'done\n', 'done branch');
  await git(repoPath, ['push', '-u', 'origin', 'shipcode/12-done']);

  await git(repoPath, ['checkout', 'main']);
  await git(repoPath, ['merge', '--no-ff', 'shipcode/12-done', '-m', 'merge done']);
  await git(repoPath, ['push', 'origin', 'main']);

  await git(repoPath, ['checkout', '-b', 'shipcode/99-unmerged', 'main']);
  await writeAndCommit(repoPath, 'unmerged.txt', 'unmerged\n', 'unmerged branch');
  await git(repoPath, ['push', '-u', 'origin', 'shipcode/99-unmerged']);
  await git(repoPath, ['checkout', 'main']);

  await git(repoPath, ['worktree', 'add', worktreePath, 'shipcode/12-done']);

  return { repoPath, worktreePath };
}

afterEach(() => {
  vi.clearAllMocks();
  listPullRequestsMock.mockReset();
  listPullRequestsMock.mockResolvedValue([]);
  if (tempRoot) {
    fs.rmSync(tempRoot, { force: true, recursive: true });
    tempRoot = null;
  }
});

describe('git workflow helpers', () => {
  it('collects dirty status files across raw, object, and empty rename entries', async () => {
    const { collectDirtyStatusFiles } = await import('./git-workflows');

    expect(
      collectDirtyStatusFiles({
        not_added: ['untracked.txt'],
        modified: ['modified.txt'],
        created: ['created.txt'],
        deleted: ['deleted.txt'],
        renamed: [
          'raw-renamed.txt',
          { from: 'old-name.txt', to: 'new-name.txt' },
          { from: '', to: 'newer-name.txt' },
          null,
        ],
        staged: ['staged.txt', 'modified.txt'],
      }),
    ).toEqual([
      'untracked.txt',
      'modified.txt',
      'created.txt',
      'deleted.txt',
      'raw-renamed.txt',
      'old-name.txt',
      'new-name.txt',
      'newer-name.txt',
      'staged.txt',
    ]);
  });
});

describe('auto-commit git workflows', () => {
  it('rejects clean worktrees before asking for generated commit groups', async () => {
    const [{ runAutoCommitWorkflow }, { repoPath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);

    await expect(
      runAutoCommitWorkflow({
        project: makeProject(repoPath),
        worktreePath: repoPath,
        provider: 'codex',
        model: 'gpt-5.1-codex',
        mode: 'single',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('worktree is clean');

    expect(generateCommitGroups).not.toHaveBeenCalled();
  }, 20_000);

  it('commits generated groups after aggregating dirty, staged, deleted, and renamed files', async () => {
    const [{ runAutoCommitWorkflow }, { repoPath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    await writeAndCommit(repoPath, 'rename-source.txt', 'rename\n', 'rename source');
    fs.writeFileSync(path.join(repoPath, 'untracked.txt'), 'untracked\n');
    fs.appendFileSync(path.join(repoPath, 'README.md'), 'modified\n');
    fs.writeFileSync(path.join(repoPath, 'staged.txt'), 'staged\n');
    await git(repoPath, ['add', 'staged.txt']);
    await git(repoPath, ['rm', 'done.txt']);
    await git(repoPath, ['mv', 'rename-source.txt', 'renamed.txt']);
    vi.mocked(generateCommitGroups).mockResolvedValueOnce({
      ok: true,
      fallbackUsed: false,
      modelUsed: 'gpt-5.1-codex',
      groups: [
        {
          files: [
            'untracked.txt',
            'README.md',
            'staged.txt',
            'done.txt',
            'rename-source.txt',
            'renamed.txt',
          ],
          message: 'chore: commit generated changes',
        },
      ],
    });

    const result = await runAutoCommitWorkflow({
      project: makeProject(repoPath),
      worktreePath: repoPath,
      provider: 'codex',
      model: 'gpt-5.1-codex',
      mode: 'split',
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      fallbackUsed: false,
      preCommitHookPath: null,
    });
    expect(result.partialFailure).toBeUndefined();
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].message).toBe('chore: commit generated changes');
    expect(vi.mocked(generateCommitGroups).mock.calls[0][0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.1-codex',
      cwd: repoPath,
      mode: 'split',
    });
    expect(vi.mocked(generateCommitGroups).mock.calls[0][0].dirtyFiles.sort()).toEqual(
      [
        'README.md',
        'done.txt',
        'rename-source.txt',
        'renamed.txt',
        'staged.txt',
        'untracked.txt',
      ].sort(),
    );
    await expect(git(repoPath, ['status', '--porcelain'])).resolves.toBe('');
  }, 20_000);

  it('returns a partial hook failure when a generated group fails pre-commit', async () => {
    const [{ runAutoCommitWorkflow }, { repoPath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(
      hookPath,
      '#!/bin/sh\necho "Running Biome on staged files"\necho "bad formatting"\nexit 1\n',
    );
    fs.chmodSync(hookPath, 0o755);
    fs.writeFileSync(path.join(repoPath, 'hooked.txt'), 'hooked\n');
    vi.mocked(generateCommitGroups).mockResolvedValueOnce({
      ok: true,
      fallbackUsed: true,
      modelUsed: 'claude-opus-4-1',
      groups: [{ files: ['hooked.txt'], message: 'chore: hooked' }],
    });

    const result = await runAutoCommitWorkflow({
      project: makeProject(repoPath),
      worktreePath: repoPath,
      provider: 'claude',
      model: 'claude-opus-4-1',
      mode: 'single',
      signal: new AbortController().signal,
    });

    expect(result.commits).toEqual([]);
    expect(result.fallbackUsed).toBe(true);
    expect(result.preCommitHookPath).toBe(fs.realpathSync(hookPath));
    expect(result.partialFailure).toMatchObject({
      groupIndex: 0,
      hookFailure: true,
      hookPath: fs.realpathSync(hookPath),
    });
    expect(result.partialFailure?.error).toContain('Running Biome on staged files');
  }, 20_000);

  it('surfaces generated commit group failures before staging', async () => {
    const [{ runAutoCommitWorkflow }, { repoPath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    fs.writeFileSync(path.join(repoPath, 'failed.txt'), 'failed\n');
    vi.mocked(generateCommitGroups).mockResolvedValueOnce({
      ok: false,
      error: 'model refused commit plan',
    });

    await expect(
      runAutoCommitWorkflow({
        project: makeProject(repoPath),
        worktreePath: repoPath,
        provider: 'codex',
        model: 'gpt-5.1-codex',
        mode: 'split',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('model refused commit plan');
  }, 20_000);

  it('returns partial failure when generated file groups do not match the staged index', async () => {
    const [{ runAutoCommitWorkflow }, { repoPath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    fs.writeFileSync(path.join(repoPath, 'one.txt'), 'one\n');
    fs.writeFileSync(path.join(repoPath, 'two.txt'), 'two\n');
    vi.mocked(generateCommitGroups).mockResolvedValueOnce({
      ok: true,
      fallbackUsed: false,
      modelUsed: 'gpt-5.1-codex',
      groups: [{ files: ['.'], message: 'chore: broad pathspec' }],
    });

    const result = await runAutoCommitWorkflow({
      project: makeProject(repoPath),
      worktreePath: repoPath,
      provider: 'codex',
      model: 'gpt-5.1-codex',
      mode: 'split',
      signal: new AbortController().signal,
    });

    expect(result.commits).toEqual([]);
    expect(result.partialFailure).toMatchObject({
      groupIndex: 0,
      hookFailure: false,
      hookPath: null,
    });
    expect(result.partialFailure?.error).toContain('index/group mismatch');
  }, 20_000);
});

describe('cleanup git workflows', () => {
  it('removes only clean branches and worktrees verified as merged into the default branch', async () => {
    const [{ runCleanupAnalyze, runCleanupApply }, { repoPath, worktreePath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    const project = makeProject(repoPath);
    const criteria = { ...DEFAULT_SETTINGS.cleanupCriteria, worktreeNoPrCleanTree: true };

    const analysis = await runCleanupAnalyze({
      project,
      criteria,
      activeSummaries: [],
      managedBranches: ['shipcode/12-done', 'shipcode/99-unmerged'],
    });

    expect(analysis.baseRef).toBe('origin/main');
    expect(analysis.items.map((item) => [item.kind, item.branch])).toEqual([
      ['worktree-no-pr-clean', 'shipcode/12-done'],
      ['remote-branch-merged', 'shipcode/12-done'],
    ]);

    const result = await runCleanupApply({
      project,
      items: analysis.items,
      itemIds: analysis.items.map((item) => item.id),
      lockFor: async (_worktreePath, fn) => fn(),
    });

    expect(result.failed).toEqual([]);
    expect(result.succeeded).toEqual(analysis.items.map((item) => item.id));
    expect(fs.existsSync(worktreePath)).toBe(false);
    await expect(
      gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/shipcode/12-done']),
    ).resolves.toBe(false);
    await expect(
      git(repoPath, ['ls-remote', '--heads', 'origin', 'shipcode/12-done']),
    ).resolves.toBe('');

    await expect(
      gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/shipcode/99-unmerged']),
    ).resolves.toBe(true);
    await expect(
      git(repoPath, ['ls-remote', '--heads', 'origin', 'shipcode/99-unmerged']),
    ).resolves.toContain('refs/heads/shipcode/99-unmerged');
  }, 20_000);

  it('filters active worktrees while retaining merged PR branch cleanup candidates', async () => {
    const [{ runCleanupAnalyze }, { repoPath, worktreePath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    listPullRequestsMock.mockResolvedValueOnce([
      {
        number: 12,
        url: 'https://github.test/acme/repo/pull/12',
        state: 'MERGED',
        headRefName: 'shipcode/12-done',
      },
      {
        number: 99,
        url: 'https://github.test/acme/repo/pull/99',
        state: 'CLOSED',
        headRefName: 'shipcode/99-unmerged',
      },
    ]);

    const analysis = await runCleanupAnalyze({
      project: makeProject(repoPath),
      criteria: { ...DEFAULT_SETTINGS.cleanupCriteria, worktreeNoPrCleanTree: true },
      activeSummaries: [{ worktreePath }, { worktreePath: null }],
      managedBranches: ['shipcode/12-done', 'shipcode/99-unmerged'],
    });

    expect(listPullRequestsMock).toHaveBeenCalledWith({ state: 'all', limit: 200 });
    expect(
      analysis.items.some((item) => 'worktreePath' in item && item.worktreePath === worktreePath),
    ).toBe(false);
    expect(analysis.items.map((item) => [item.kind, item.branch])).toContainEqual([
      'remote-branch-merged',
      'shipcode/12-done',
    ]);
  }, 20_000);

  it('continues cleanup analysis when fetch and live PR lookup fail', async () => {
    const [{ runCleanupAnalyze }, { repoPath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    await git(repoPath, ['remote', 'remove', 'origin']);
    listPullRequestsMock.mockRejectedValueOnce(new Error('gh offline'));

    const analysis = await runCleanupAnalyze({
      project: makeProject(repoPath),
      criteria: { ...DEFAULT_SETTINGS.cleanupCriteria, worktreeNoPrCleanTree: true },
      activeSummaries: [],
      managedBranches: ['shipcode/12-done', 'shipcode/99-unmerged'],
    });

    expect(listPullRequestsMock).toHaveBeenCalledWith({ state: 'all', limit: 200 });
    expect(analysis.protectedBranches).toEqual(['main', 'master']);
    expect(analysis.baseRef).toBe('origin/main');
  }, 20_000);

  it('reports per-item cleanup apply failures for dirty, ahead, unmerged, and stale selections', async () => {
    const [{ runCleanupApply }, { repoPath, worktreePath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    fs.writeFileSync(path.join(worktreePath, 'dirty.txt'), 'dirty\n');

    const result = await runCleanupApply({
      project: makeProject(repoPath),
      items: [
        {
          id: 'dirty-worktree',
          kind: 'worktree-no-pr-clean',
          branch: 'shipcode/12-done',
          worktreePath,
          dirty: false,
          aheadCount: 0,
          behindCount: 0,
          compareRef: 'origin/main',
        },
        {
          id: 'ahead-local',
          kind: 'local-branch-no-remote',
          branch: 'ship/ahead',
          aheadCount: 2,
          behindCount: 0,
          compareRef: 'origin/main',
        },
        {
          id: 'unmerged-remote',
          kind: 'remote-branch-merged',
          branch: 'shipcode/99-unmerged',
          remote: 'origin',
          aheadCount: 1,
          behindCount: 0,
          compareRef: null,
        },
      ] as CleanupItem[],
      itemIds: ['dirty-worktree', 'ahead-local', 'unmerged-remote', 'missing-item'],
      lockFor: async (_worktreePath, fn) => fn(),
    });

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'dirty-worktree',
          error: expect.stringContaining('worktree dirty'),
        }),
        expect.objectContaining({
          itemId: 'ahead-local',
          error: expect.stringContaining('branch has 2 local commits ahead'),
        }),
        expect.objectContaining({
          itemId: 'unmerged-remote',
          error: expect.stringContaining('the default branch'),
        }),
        {
          itemId: 'missing-item',
          error: 'not eligible after clean/merged re-check',
        },
      ]),
    );
  }, 20_000);

  it('applies artifact cleanup without deleting the worktree or branch', async () => {
    const [{ runCleanupApply }, { repoPath, worktreePath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    fs.mkdirSync(path.join(worktreePath, 'node_modules/pkg'), { recursive: true });
    fs.mkdirSync(path.join(worktreePath, '.next/cache'), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, 'source.txt'), 'keep\n');

    const result = await runCleanupApply({
      project: makeProject(repoPath),
      items: [
        {
          id: 'artifacts',
          kind: 'worktree-artifacts',
          branch: 'shipcode/12-done',
          worktreePath,
          artifactPaths: ['node_modules', '.next'],
        },
      ] as CleanupItem[],
      itemIds: ['artifacts'],
      lockFor: async (_worktreePath, fn) => fn(),
    });

    expect(result).toEqual({ succeeded: ['artifacts'], failed: [] });
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(path.join(worktreePath, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(worktreePath, '.next'))).toBe(false);
    expect(fs.existsSync(path.join(worktreePath, 'source.txt'))).toBe(true);
    await expect(
      gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/shipcode/12-done']),
    ).resolves.toBe(true);
  }, 20_000);

  it('applies cleanup with unselected skips, worktree ahead checks, remove failures, and branch deletion', async () => {
    const [{ runCleanupApply }, { repoPath, worktreePath }] = await Promise.all([
      import('./git-workflows'),
      createFixtureRepo(),
    ]);
    const aheadWorktreePath = path.join(tempRoot ?? repoPath, 'worktree-shipcode-99-unmerged');
    await git(repoPath, ['worktree', 'add', aheadWorktreePath, 'shipcode/99-unmerged']);
    await git(repoPath, ['branch', 'skip/me', 'main']);
    await git(repoPath, ['branch', 'local/merged-cleanup', 'main']);

    const result = await runCleanupApply({
      project: makeProject(repoPath),
      items: [
        {
          id: 'skip-me',
          kind: 'local-branch-merged',
          branch: 'skip/me',
          aheadCount: 0,
          behindCount: 0,
          compareRef: 'origin/main',
        },
        {
          id: 'ahead-worktree',
          kind: 'worktree-no-pr-clean',
          branch: 'shipcode/99-unmerged',
          worktreePath: aheadWorktreePath,
          dirty: false,
          aheadCount: 0,
          behindCount: 0,
          compareRef: 'origin/main',
        },
        {
          id: 'remove-error',
          kind: 'worktree-no-pr-clean',
          branch: 'shipcode/12-done',
          worktreePath,
          dirty: false,
          aheadCount: 0,
          behindCount: 0,
          compareRef: 'origin/main',
        },
        {
          id: 'delete-local',
          kind: 'local-branch-merged',
          branch: 'local/merged-cleanup',
          aheadCount: 0,
          behindCount: 0,
          compareRef: 'origin/main',
        },
      ] as CleanupItem[],
      itemIds: ['ahead-worktree', 'remove-error', 'delete-local'],
      lockFor: async (lockedWorktreePath, fn) => {
        if (lockedWorktreePath === worktreePath) {
          return { success: false, error: 'remove failed' } as Awaited<ReturnType<typeof fn>>;
        }
        return fn();
      },
    });

    expect(result.succeeded).toEqual(['delete-local']);
    expect(result.failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'ahead-worktree',
          error: expect.stringContaining('worktree has 1 local commit ahead'),
        }),
        {
          itemId: 'remove-error',
          error: 'remove failed',
        },
      ]),
    );
    expect(
      await gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/local/merged-cleanup']),
    ).toBe(false);
    expect(await gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/skip/me'])).toBe(true);
  }, 20_000);
});
