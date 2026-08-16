import { type CleanupCriteria, type CleanupItem, isShipCodeBranch } from '@shipcode/shared';

export interface PullRequestSnapshot {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  headRef: string;
  merged: boolean;
}

export interface BranchSnapshot {
  name: string;
  hasRemote: boolean;
  remoteName?: string | null;
  lastCommitDate: string;
  aheadCount?: number;
  behindCount?: number;
  compareRef?: string | null;
}

export interface RemoteBranchSnapshot {
  name: string;
  remote: string;
  lastCommitDate: string;
  aheadCount?: number;
  behindCount?: number;
  compareRef?: string | null;
}

export interface CleanupAnalysisInput {
  worktrees: Array<{
    path: string;
    branch: string;
    dirty: boolean;
    aheadCount?: number;
    behindCount?: number;
    compareRef?: string | null;
    artifactPaths?: string[];
  }>;
  branches: BranchSnapshot[];
  remoteBranches?: RemoteBranchSnapshot[];
  pullRequests: PullRequestSnapshot[];
  criteria: CleanupCriteria;
  protectedBranches: string[];
  managedBranches?: string[];
}

/**
 * Pure function: maps worktrees + branches + PRs to a list of cleanup items
 * the user can review. Never mutates input. Items respect protected list and
 * the user-configured criteria toggles.
 */
export function analyzeCleanup(input: CleanupAnalysisInput): CleanupItem[] {
  const items: CleanupItem[] = [];
  const protectedSet = new Set(input.protectedBranches);
  const managedSet = new Set(input.managedBranches ?? []);
  const prByHead = new Map<string, PullRequestSnapshot>();
  for (const pr of input.pullRequests) {
    prByHead.set(pr.headRef, pr);
  }

  const isVerifiedMerged = (value: { aheadCount?: number; compareRef?: string | null }) =>
    value.compareRef != null && (value.aheadCount ?? 0) === 0;
  const isManagedBranch = (branch: string) =>
    managedSet.has(branch) || prByHead.has(branch) || isShipCodeBranch(branch);
  const worktreeBranches = new Set(input.worktrees.map((wt) => wt.branch));

  for (const wt of input.worktrees) {
    if (protectedSet.has(wt.branch)) continue;
    const artifactPaths = wt.artifactPaths ?? [];
    if (artifactPaths.length > 0) {
      items.push({
        id: `wt-artifacts:${wt.path}`,
        kind: 'worktree-artifacts',
        worktreePath: wt.path,
        branch: wt.branch,
        artifactPaths,
      });
    }

    const aheadCount = wt.aheadCount ?? 0;
    const behindCount = wt.behindCount ?? 0;
    const compareRef = wt.compareRef ?? null;
    const hasLocalWork = wt.dirty || aheadCount > 0;
    if (hasLocalWork || !isVerifiedMerged({ aheadCount, compareRef })) continue;
    const pr = prByHead.get(wt.branch);
    if (!pr) {
      if (input.criteria.worktreeNoPrCleanTree && isManagedBranch(wt.branch)) {
        items.push({
          id: `wt-no-pr:${wt.path}`,
          kind: 'worktree-no-pr-clean',
          worktreePath: wt.path,
          branch: wt.branch,
          dirty: false,
          aheadCount,
          behindCount,
          compareRef,
        });
      }
      continue;
    }

    if (pr.merged && input.criteria.worktreeMergedPr) {
      items.push({
        id: `wt-merged:${wt.path}`,
        kind: 'worktree-merged-pr',
        worktreePath: wt.path,
        branch: wt.branch,
        prNumber: pr.number,
        prUrl: pr.url,
        dirty: hasLocalWork,
        aheadCount,
        behindCount,
        compareRef,
      });
      continue;
    }

    if (pr.state === 'closed' && !pr.merged && input.criteria.worktreeClosedPr) {
      items.push({
        id: `wt-closed:${wt.path}`,
        kind: 'worktree-closed-pr',
        worktreePath: wt.path,
        branch: wt.branch,
        prNumber: pr.number,
        prUrl: pr.url,
        dirty: hasLocalWork,
        aheadCount,
        behindCount,
        compareRef,
      });
    }
  }

  for (const branch of input.branches) {
    if (protectedSet.has(branch.name)) continue;
    if (worktreeBranches.has(branch.name)) continue;
    if (!isVerifiedMerged(branch)) continue;

    const compareRef = branch.compareRef as string;
    const pr = prByHead.get(branch.name);
    const remoteBranch = branch.remoteName?.startsWith('origin/')
      ? branch.remoteName.slice('origin/'.length)
      : (branch.remoteName ?? null);

    if (branch.hasRemote) {
      if (input.criteria.localBranchMerged && isManagedBranch(branch.name)) {
        items.push({
          id: `branch-merged:${branch.name}`,
          kind: 'local-branch-merged',
          branch: branch.name,
          lastCommitDate: branch.lastCommitDate,
          aheadCount: branch.aheadCount ?? 0,
          behindCount: branch.behindCount ?? 0,
          compareRef,
          remoteBranch,
          prNumber: pr?.number ?? null,
        });
      }
      continue;
    }

    if (input.criteria.localBranchNoRemote) {
      items.push({
        id: `branch-no-remote:${branch.name}`,
        kind: 'local-branch-no-remote',
        branch: branch.name,
        lastCommitDate: branch.lastCommitDate,
        aheadCount: branch.aheadCount ?? 0,
        behindCount: branch.behindCount ?? 0,
        compareRef,
      });
    }
  }

  if (input.criteria.remoteBranchMerged) {
    const unsafeWorktreeBranches = new Set(
      input.worktrees.filter((wt) => wt.dirty || (wt.aheadCount ?? 0) > 0).map((wt) => wt.branch),
    );

    for (const branch of input.remoteBranches ?? []) {
      if (protectedSet.has(branch.name)) continue;
      if (unsafeWorktreeBranches.has(branch.name)) continue;
      if (!isVerifiedMerged(branch)) continue;
      if (!isManagedBranch(branch.name)) continue;
      const compareRef = branch.compareRef as string;
      const pr = prByHead.get(branch.name);
      items.push({
        id: `remote-merged:${branch.remote}/${branch.name}`,
        kind: 'remote-branch-merged',
        branch: branch.name,
        remote: branch.remote,
        lastCommitDate: branch.lastCommitDate,
        aheadCount: branch.aheadCount ?? 0,
        behindCount: branch.behindCount ?? 0,
        compareRef,
        prNumber: pr?.number ?? null,
      });
    }
  }

  return items;
}
