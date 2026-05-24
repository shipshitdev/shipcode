import { GhCli, generateCommitGroups } from '@shipcode/agents';
import { analyzeCleanup, GitService, WorktreeManager } from '@shipcode/git';
import type {
  AutoCommitResult,
  CleanupAnalyzeResult,
  CleanupApplyResult,
  CleanupItem,
  ExecutorModel,
  Project,
} from '@shipcode/shared';
import { stripAnsi } from '@shipcode/shared';
import log from './logger.service';

interface ActiveWorktreeOwner {
  worktreePath: string | null;
}

function summarizeCommitFailure(value: string): string {
  const lines = stripAnsi(value)
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      return trimmed ? [trimmed] : [];
    });
  const summary = lines.slice(0, 8).join('\n');
  return summary.length > 800 ? `${summary.slice(0, 797)}...` : summary;
}

function isLikelyHookFailure(message: string): boolean {
  return /\b(pre-commit|hook|biome check|Running Biome on staged files)\b/i.test(message);
}

export function collectDirtyStatusFiles(status: {
  not_added: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  renamed: Array<string | { from?: string; to?: string } | null>;
  staged: string[];
}): string[] {
  const dirtySet = new Set<string>();
  for (const f of status.not_added) dirtySet.add(f);
  for (const f of status.modified) dirtySet.add(f);
  for (const f of status.created) dirtySet.add(f);
  for (const f of status.deleted) dirtySet.add(f);
  for (const r of status.renamed) {
    if (typeof r === 'string') dirtySet.add(r);
    else if (r && typeof r === 'object') {
      const renamed = r as { from?: string; to?: string };
      if (renamed.from) dirtySet.add(renamed.from);
      if (renamed.to) dirtySet.add(renamed.to);
    }
  }
  for (const f of status.staged) dirtySet.add(f);
  return [...dirtySet];
}

/**
 * Runs the full auto-commit workflow against a worktree:
 *   enumerate dirty → ask LLM → validate groups → stage+commit each
 * Caller must hold the per-worktree mutex.
 */
export async function runAutoCommitWorkflow(args: {
  project: Project;
  worktreePath: string;
  apiKey?: string;
  provider: ExecutorModel;
  model: string;
  mode: 'split' | 'single';
  signal: AbortSignal;
}): Promise<AutoCommitResult> {
  const git = new GitService(args.project.path);
  const [status, preCommitHookPath] = await Promise.all([
    git.getRawStatus(args.worktreePath),
    git.getPreCommitHookPath(args.worktreePath),
  ]);

  // Aggregate every changed/untracked path into a single dirty set.
  const dirtyFiles = collectDirtyStatusFiles(status);
  if (dirtyFiles.length === 0) {
    throw new Error('worktree is clean — nothing to commit');
  }

  const diff = await git.getDiffAgainstHead(args.worktreePath);

  const result = await generateCommitGroups({
    apiKey: args.apiKey,
    provider: args.provider,
    model: args.model,
    cwd: args.worktreePath,
    dirtyFiles,
    diff,
    signal: args.signal,
    mode: args.mode,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }

  const commits: Array<{ sha: string; message: string }> = [];
  const commitNextGroup = async (i: number): Promise<AutoCommitResult | null> => {
    if (i >= result.groups.length) return null;
    const group = result.groups[i];
    try {
      const staged = await git
        .resetIndex(args.worktreePath)
        .then(() => git.addPaths(group.files, args.worktreePath))
        .then(() => git.getStagedFiles(args.worktreePath));
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
      return commitNextGroup(i + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`[auto-commit] group ${i} failed: ${message}`);
      const hookFailure = !!preCommitHookPath && isLikelyHookFailure(message);
      return {
        commits,
        fallbackUsed: result.fallbackUsed,
        preCommitHookPath,
        partialFailure: {
          groupIndex: i,
          error: summarizeCommitFailure(message),
          hookFailure,
          hookPath: hookFailure ? preCommitHookPath : null,
        },
      };
    }
  };

  return (
    (await commitNextGroup(0)) ?? { commits, fallbackUsed: result.fallbackUsed, preCommitHookPath }
  );
}

/**
 * Pure analyze pass for the cleanup modal. Live `gh` PR fetch — no cache.
 * Includes dirty-tree and merged-into-default checks before surfacing candidates.
 */
export async function runCleanupAnalyze(args: {
  project: Project;
  criteria: import('@shipcode/shared').CleanupCriteria;
  activeSummaries: ActiveWorktreeOwner[];
  managedBranches?: string[];
}): Promise<CleanupAnalyzeResult> {
  const git = new GitService(args.project.path);
  const wt = new WorktreeManager(args.project.path);

  try {
    await git.fetch();
  } catch (err) {
    log.warn(`[cleanup] git fetch failed: ${(err as Error).message}`);
  }

  const defaultBranchPromise = Promise.resolve(
    args.project.defaultBranch || git.getDefaultBranch(),
  );
  const [defaultBranch, worktreeList, branchList, remoteBranchList] = await Promise.all([
    defaultBranchPromise,
    wt.list(),
    git.listLocalBranchesWithMeta(),
    git.listRemoteBranchesWithMeta('origin'),
  ]);
  const baseRef = await git.resolveFirstExistingRef([`origin/${defaultBranch}`, defaultBranch]);

  const protectedBranches = Array.from(new Set([defaultBranch, 'main', 'master']));

  // Live PR fetch — no DB cache exists for PRs.
  let prs: Awaited<ReturnType<GhCli['listPullRequests']>> = [];
  try {
    const cli = new GhCli(args.project.path);
    prs = await cli.listPullRequests({ state: 'all', limit: 200 });
  } catch (err) {
    log.warn(`[cleanup] gh listPullRequests failed: ${(err as Error).message}`);
  }

  const [dirtyMap, artifactEntries, statusEntries, branches, remoteBranches] = await Promise.all([
    git.getDirtyWorktrees(worktreeList.map((w) => w.path)),
    Promise.all(
      worktreeList.map(async (w) => {
        try {
          const artifacts = await wt.listArtifacts(w.path);
          return [w.path, artifacts.map((artifact) => artifact.relativePath)] as const;
        } catch {
          return [w.path, [] as string[]] as const;
        }
      }),
    ),
    Promise.all(
      worktreeList.map(async (w) => {
        try {
          return [
            w.path,
            await git.getStatus(w.path, baseRef ?? defaultBranch, { preferFallbackRef: true }),
          ] as const;
        } catch {
          return [w.path, null] as const;
        }
      }),
    ),
    Promise.all(
      branchList.map(async (branch) => {
        const divergence = baseRef
          ? await git.getBranchDivergence(branch.name, baseRef)
          : { aheadCount: 0, behindCount: 0, compareRef: null };
        return {
          ...branch,
          aheadCount: divergence.aheadCount,
          behindCount: divergence.behindCount,
          compareRef: divergence.compareRef,
        };
      }),
    ),
    Promise.all(
      remoteBranchList.map(async (branch) => {
        const fullRef = `${branch.remote}/${branch.name}`;
        const divergence = baseRef
          ? await git.getBranchDivergence(fullRef, baseRef)
          : { aheadCount: 0, behindCount: 0, compareRef: null };
        return {
          ...branch,
          aheadCount: divergence.aheadCount,
          behindCount: divergence.behindCount,
          compareRef: divergence.compareRef,
        };
      }),
    ),
  ]);
  const statusMap = new Map(statusEntries);
  const artifactMap = new Map(artifactEntries);

  const items = analyzeCleanup({
    worktrees: worktreeList.map((w) => {
      const status = statusMap.get(w.path);
      return {
        path: w.path,
        branch: w.branch,
        dirty: dirtyMap.get(w.path) ?? false,
        aheadCount: status?.aheadCount ?? 0,
        behindCount: status?.behindCount ?? 0,
        compareRef: status?.compareRef ?? null,
        artifactPaths: artifactMap.get(w.path) ?? [],
      };
    }),
    branches,
    remoteBranches,
    pullRequests: prs.map((pr) => ({
      number: pr.number,
      url: pr.url,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
      headRef: pr.headRefName,
      merged: pr.state === 'MERGED',
    })),
    criteria: args.criteria,
    protectedBranches,
    managedBranches: [...(args.managedBranches ?? []), ...worktreeList.map((w) => w.branch)],
  });

  // Refuse to surface a worktree that has an active pipeline operating on it.
  const activeWorktreePaths = new Set(
    args.activeSummaries.flatMap((s) => (s.worktreePath ? [s.worktreePath] : [])),
  );
  const filtered = items.filter((it) => {
    if (
      it.kind === 'worktree-merged-pr' ||
      it.kind === 'worktree-closed-pr' ||
      it.kind === 'worktree-no-pr-clean' ||
      it.kind === 'worktree-artifacts'
    ) {
      return !activeWorktreePaths.has(it.worktreePath);
    }
    return true;
  });

  return { items: filtered, protectedBranches, baseRef };
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

  const selectedIds = new Set(args.itemIds);
  const processedIds = new Set<string>();

  const assertMerged = async (ref: string, compareRef: string | null, label: string) => {
    if (!compareRef || !(await git.isRefMergedInto(ref, compareRef))) {
      throw new Error(`${label} is not verified merged into ${compareRef ?? 'the default branch'}`);
    }
  };

  const settled = await Promise.all(
    args.items.flatMap((item) => {
      if (!selectedIds.has(item.id)) return [];
      processedIds.add(item.id);
      return [
        (async (): Promise<{ itemId: string; ok: true } | { itemId: string; error: string }> => {
          try {
            if (
              item.kind === 'worktree-merged-pr' ||
              item.kind === 'worktree-closed-pr' ||
              item.kind === 'worktree-no-pr-clean'
            ) {
              const status = await git.getStatus(item.worktreePath, item.compareRef ?? undefined, {
                preferFallbackRef: item.compareRef != null,
              });
              if (status.isDirty) {
                throw new Error(`worktree dirty — refusing to remove: ${item.worktreePath}`);
              }
              if (status.aheadCount > 0) {
                throw new Error(
                  `worktree has ${status.aheadCount} local commit${status.aheadCount === 1 ? '' : 's'} ahead of ${status.compareRef ?? 'the compare ref'} — refusing to remove: ${item.worktreePath}`,
                );
              }
              await assertMerged(item.branch, item.compareRef, `branch ${item.branch}`);
              const result = await args.lockFor(item.worktreePath, async () => {
                return wt.remove(item.worktreePath, item.branch);
              });
              if (result.error) throw new Error(result.error);
            } else if (item.kind === 'worktree-artifacts') {
              const result = await args.lockFor(item.worktreePath, async () => {
                return wt.pruneArtifacts(item.worktreePath);
              });
              if (result.failed.length > 0) {
                throw new Error(
                  result.failed
                    .map((failure) => `${failure.relativePath}: ${failure.error}`)
                    .join('\n'),
                );
              }
            } else if (
              item.kind === 'local-branch-no-remote' ||
              item.kind === 'local-branch-merged'
            ) {
              if ((item.aheadCount ?? 0) > 0) {
                throw new Error(
                  `branch has ${item.aheadCount} local commit${item.aheadCount === 1 ? '' : 's'} ahead of ${item.compareRef ?? 'the compare ref'} — refusing to delete: ${item.branch}`,
                );
              }
              await assertMerged(item.branch, item.compareRef ?? null, `branch ${item.branch}`);
              await git.deleteLocalBranch(item.branch);
            } else if (item.kind === 'remote-branch-merged') {
              await assertMerged(
                `${item.remote}/${item.branch}`,
                item.compareRef,
                `remote branch ${item.remote}/${item.branch}`,
              );
              await git.deleteRemoteBranch(item.branch, item.remote);
            }
            return { itemId: item.id, ok: true };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { itemId: item.id, error: message };
          }
        })(),
      ];
    }),
  );

  const succeeded: string[] = [];
  const failed: Array<{ itemId: string; error: string }> = [];
  for (const item of settled) {
    if ('ok' in item) {
      succeeded.push(item.itemId);
    } else {
      failed.push(item);
    }
  }

  for (const itemId of selectedIds) {
    if (!processedIds.has(itemId)) {
      failed.push({ itemId, error: 'not eligible after clean/merged re-check' });
    }
  }

  return { succeeded, failed };
}
