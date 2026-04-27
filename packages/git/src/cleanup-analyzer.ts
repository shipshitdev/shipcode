import type { CleanupCriteria, CleanupItem } from '@shipcode/shared';

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
  lastCommitDate: string;
}

export interface CleanupAnalysisInput {
  worktrees: Array<{ path: string; branch: string; dirty: boolean }>;
  branches: BranchSnapshot[];
  pullRequests: PullRequestSnapshot[];
  criteria: CleanupCriteria;
  protectedBranches: string[];
}

/**
 * Pure function: maps worktrees + branches + PRs to a list of cleanup items
 * the user can review. Never mutates input. Items respect protected list and
 * the user-configured criteria toggles.
 */
export function analyzeCleanup(input: CleanupAnalysisInput): CleanupItem[] {
  const items: CleanupItem[] = [];
  const protectedSet = new Set(input.protectedBranches);
  const prByHead = new Map<string, PullRequestSnapshot>();
  for (const pr of input.pullRequests) {
    prByHead.set(pr.headRef, pr);
  }

  for (const wt of input.worktrees) {
    if (protectedSet.has(wt.branch)) continue;
    const pr = prByHead.get(wt.branch);
    if (!pr) {
      if (input.criteria.worktreeNoPrCleanTree && !wt.dirty) {
        items.push({
          id: `wt-no-pr:${wt.path}`,
          kind: 'local-branch-no-remote',
          branch: wt.branch,
          lastCommitDate: '',
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
        dirty: wt.dirty,
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
        dirty: wt.dirty,
      });
    }
  }

  if (input.criteria.localBranchNoRemote) {
    const worktreeBranches = new Set(input.worktrees.map((wt) => wt.branch));
    for (const branch of input.branches) {
      if (protectedSet.has(branch.name)) continue;
      if (branch.hasRemote) continue;
      if (worktreeBranches.has(branch.name)) continue;
      items.push({
        id: `branch-no-remote:${branch.name}`,
        kind: 'local-branch-no-remote',
        branch: branch.name,
        lastCommitDate: branch.lastCommitDate,
      });
    }
  }

  return items;
}
