import { GhCli, generateCommitGroups } from '@shipcode/agents';
import { analyzeCleanup, GitService, WorktreeManager } from '@shipcode/git';
import type {
  AutoCommitResult,
  CleanupAnalyzeResult,
  CleanupApplyResult,
  CleanupItem,
  Project,
} from '@shipcode/shared';
import log from './logger.service';

interface ActiveWorktreeOwner {
  worktreePath: string | null;
}

/**
 * Runs the full auto-commit workflow against a worktree:
 *   enumerate dirty → ask LLM → validate groups → stage+commit each
 * Caller must hold the per-worktree mutex.
 */
export async function runAutoCommitWorkflow(args: {
  project: Project;
  worktreePath: string;
  apiKey: string;
  model: string;
  mode: 'split' | 'single';
  signal: AbortSignal;
}): Promise<AutoCommitResult> {
  const git = new GitService(args.project.path);
  const status = await git.getRawStatus(args.worktreePath);

  // Aggregate every changed/untracked path into a single dirty set.
  const dirtySet = new Set<string>();
  for (const f of status.not_added) dirtySet.add(f);
  for (const f of status.modified) dirtySet.add(f);
  for (const f of status.created) dirtySet.add(f);
  for (const f of status.deleted) dirtySet.add(f);
  for (const r of status.renamed) {
    if (typeof r === 'string') dirtySet.add(r);
    else if (r && typeof r === 'object' && 'to' in r) dirtySet.add((r as { to: string }).to);
  }
  for (const f of status.staged) dirtySet.add(f);

  const dirtyFiles = [...dirtySet];
  if (dirtyFiles.length === 0) {
    throw new Error('worktree is clean — nothing to commit');
  }

  const diff = await git.getDiffAgainstHead(args.worktreePath);

  const result = await generateCommitGroups({
    apiKey: args.apiKey,
    model: args.model,
    dirtyFiles,
    diff,
    signal: args.signal,
    mode: args.mode,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }

  const commits: Array<{ sha: string; message: string }> = [];
  for (let i = 0; i < result.groups.length; i++) {
    const group = result.groups[i];
    try {
      await git.resetIndex(args.worktreePath);
      await git.addPaths(group.files, args.worktreePath);
      const staged = await git.getStagedFiles(args.worktreePath);
      const stagedSet = new Set(staged);
      const expectedSet = new Set(group.files);
      // Verify the index matches what the group asked for. simple-git can
      // silently expand pathspecs; bail if it diverges.
      if (stagedSet.size !== expectedSet.size || [...expectedSet].some((f) => !stagedSet.has(f))) {
        throw new Error(
          `index/group mismatch: expected ${[...expectedSet].join(',')} got ${[...stagedSet].join(',')}`,
        );
      }
      const sha = await git.commitStaged(group.message, args.worktreePath);
      commits.push({ sha, message: group.message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`[auto-commit] group ${i} failed: ${message}`);
      return {
        commits,
        fallbackUsed: result.fallbackUsed,
        partialFailure: { groupIndex: i, error: message },
      };
    }
  }

  return { commits, fallbackUsed: result.fallbackUsed };
}

/**
 * Pure analyze pass for the cleanup modal. Live `gh` PR fetch — no cache.
 * Includes a dirty-tree probe so the UI can warn before destructive actions.
 */
export async function runCleanupAnalyze(args: {
  project: Project;
  criteria: import('@shipcode/shared').CleanupCriteria;
  activeSummaries: ActiveWorktreeOwner[];
}): Promise<CleanupAnalyzeResult> {
  const git = new GitService(args.project.path);
  const wt = new WorktreeManager(args.project.path);

  const [worktreeList, branchList, defaultBranch] = await Promise.all([
    wt.list(),
    git.listLocalBranchesWithMeta(),
    git.getDefaultBranch(),
  ]);

  const worktreeBranchSet = new Set(worktreeList.map((w) => w.branch));
  const protectedBranches = Array.from(
    new Set([defaultBranch, 'main', 'master', ...worktreeBranchSet]),
  );

  // Live PR fetch — no DB cache exists for PRs.
  let prs: Awaited<ReturnType<GhCli['listPullRequests']>> = [];
  try {
    const cli = new GhCli(args.project.path);
    prs = await cli.listPullRequests({ state: 'all', limit: 200 });
  } catch (err) {
    log.warn(`[cleanup] gh listPullRequests failed: ${(err as Error).message}`);
  }

  const dirtyMap = await git.getDirtyWorktrees(worktreeList.map((w) => w.path));

  const items = analyzeCleanup({
    worktrees: worktreeList.map((w) => ({
      path: w.path,
      branch: w.branch,
      dirty: dirtyMap.get(w.path) ?? false,
    })),
    branches: branchList,
    pullRequests: prs.map((pr) => ({
      number: pr.number,
      url: pr.url,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
      headRef: pr.headRefName,
      merged: pr.state === 'MERGED',
    })),
    criteria: args.criteria,
    protectedBranches,
  });

  // Refuse to surface a worktree that has an active pipeline operating on it.
  const activeWorktreePaths = new Set(
    args.activeSummaries.map((s) => s.worktreePath).filter((p): p is string => !!p),
  );
  const filtered = items.filter((it) => {
    if (it.kind === 'worktree-merged-pr' || it.kind === 'worktree-closed-pr') {
      return !activeWorktreePaths.has(it.worktreePath);
    }
    return true;
  });

  return { items: filtered, protectedBranches };
}

/**
 * Apply selected cleanup items. Per-item error isolation.
 * Caller is responsible for passing `lockFor` that acquires per-worktree mutex.
 */
export async function runCleanupApply(args: {
  project: Project;
  items: CleanupItem[];
  itemIds: string[];
  lockFor: <T>(worktreePath: string, fn: () => Promise<T>) => Promise<T>;
}): Promise<CleanupApplyResult> {
  const git = new GitService(args.project.path);
  const wt = new WorktreeManager(args.project.path);

  const succeeded: string[] = [];
  const failed: Array<{ itemId: string; error: string }> = [];
  const selectedIds = new Set(args.itemIds);

  for (const item of args.items) {
    if (!selectedIds.has(item.id)) continue;
    try {
      if (item.kind === 'worktree-merged-pr' || item.kind === 'worktree-closed-pr') {
        if (item.dirty) {
          throw new Error(`worktree dirty — refusing to remove: ${item.worktreePath}`);
        }
        const result = await args.lockFor(item.worktreePath, async () => {
          return wt.remove(item.worktreePath, item.branch);
        });
        if (result.error) throw new Error(result.error);
      } else if (item.kind === 'local-branch-no-remote') {
        await git.deleteLocalBranch(item.branch);
      } else if (item.kind === 'remote-branch-merged') {
        await git.deleteRemoteBranch(item.branch);
      }
      succeeded.push(item.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ itemId: item.id, error: message });
    }
  }

  return { succeeded, failed };
}
