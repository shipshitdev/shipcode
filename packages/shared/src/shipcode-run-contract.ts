export interface ShipCodeRunContractContext {
  projectPath: string;
  worktreePath: string | null | undefined;
  baseBranch: string | null | undefined;
  currentBranch: string | null | undefined;
  githubIssueNumber: number;
  sourceLabel?: string;
}

export function buildShipCodeRunContract({
  projectPath,
  worktreePath,
  baseBranch,
  currentBranch,
  githubIssueNumber,
  sourceLabel = `GitHub issue #${githubIssueNumber}`,
}: ShipCodeRunContractContext): string {
  const effectiveWorktreePath = worktreePath?.trim() || projectPath;
  const effectiveCurrentBranch = currentBranch?.trim() || '(current worktree branch)';
  const effectiveBaseBranch = baseBranch?.trim() || '(default branch)';

  return `You are working inside ShipCode, an app that runs coding agents in isolated git worktrees.

## Workspace

- Repo: ${projectPath}
- Worktree: ${effectiveWorktreePath}
- Target branch: ${effectiveBaseBranch}
- Current branch: ${effectiveCurrentBranch}
- GitHub issue: #${githubIssueNumber}
- PRD/source instructions: ${sourceLabel}

## Rules

- Do all work in the provided worktree.
- Do not rename the current branch.
- Diff against ${effectiveBaseBranch}.
- Treat the GitHub issue/PRD below as the source of truth.
- If instructions conflict, prefer explicit user/PRD instructions over generated defaults.
- Keep changes scoped to the issue/PRD.
- Run relevant tests, typecheck, and lint before finishing when available.
- Final response must include changed files, verification run, and anything needing review.`;
}
