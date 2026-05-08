import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_SETTINGS, type Project } from '@shipcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    listPullRequests = vi.fn(async () => []);
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
  const worktreePath = path.join(tempRoot, 'worktree-ship-12-done');

  fs.mkdirSync(repoPath);
  await execFileAsync('git', ['init', '--bare', remotePath]);
  await execFileAsync('git', ['init', '--initial-branch=main', repoPath]);
  await git(repoPath, ['config', 'user.email', 'shipcode@example.test']);
  await git(repoPath, ['config', 'user.name', 'ShipCode Test']);
  await git(repoPath, ['remote', 'add', 'origin', remotePath]);

  await writeAndCommit(repoPath, 'README.md', 'initial\n', 'initial commit');
  await git(repoPath, ['push', '-u', 'origin', 'main']);

  await git(repoPath, ['checkout', '-b', 'ship/12-done']);
  await writeAndCommit(repoPath, 'done.txt', 'done\n', 'done branch');
  await git(repoPath, ['push', '-u', 'origin', 'ship/12-done']);

  await git(repoPath, ['checkout', 'main']);
  await git(repoPath, ['merge', '--no-ff', 'ship/12-done', '-m', 'merge done']);
  await git(repoPath, ['push', 'origin', 'main']);

  await git(repoPath, ['checkout', '-b', 'ship/99-unmerged', 'main']);
  await writeAndCommit(repoPath, 'unmerged.txt', 'unmerged\n', 'unmerged branch');
  await git(repoPath, ['push', '-u', 'origin', 'ship/99-unmerged']);
  await git(repoPath, ['checkout', 'main']);

  await git(repoPath, ['worktree', 'add', worktreePath, 'ship/12-done']);

  return { repoPath, worktreePath };
}

afterEach(() => {
  if (tempRoot) {
    fs.rmSync(tempRoot, { force: true, recursive: true });
    tempRoot = null;
  }
});

describe('cleanup git workflows', () => {
  it('removes only clean branches and worktrees verified as merged into the default branch', async () => {
    const { runCleanupAnalyze, runCleanupApply } = await import('./git-workflows');
    const { repoPath, worktreePath } = await createFixtureRepo();
    const project = makeProject(repoPath);
    const criteria = { ...DEFAULT_SETTINGS.cleanupCriteria, worktreeNoPrCleanTree: true };

    const analysis = await runCleanupAnalyze({
      project,
      criteria,
      activeSummaries: [],
      managedBranches: ['ship/12-done', 'ship/99-unmerged'],
    });

    expect(analysis.baseRef).toBe('origin/main');
    expect(analysis.items.map((item) => [item.kind, item.branch])).toEqual([
      ['worktree-no-pr-clean', 'ship/12-done'],
      ['remote-branch-merged', 'ship/12-done'],
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
      gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/ship/12-done']),
    ).resolves.toBe(false);
    await expect(git(repoPath, ['ls-remote', '--heads', 'origin', 'ship/12-done'])).resolves.toBe(
      '',
    );

    await expect(
      gitCan(repoPath, ['show-ref', '--verify', 'refs/heads/ship/99-unmerged']),
    ).resolves.toBe(true);
    await expect(
      git(repoPath, ['ls-remote', '--heads', 'origin', 'ship/99-unmerged']),
    ).resolves.toContain('refs/heads/ship/99-unmerged');
  }, 20_000);
});
