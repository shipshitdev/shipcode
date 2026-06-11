import { buildShipCodeRunContract } from '@shipcode/shared';

export interface IssueRunPromptContext {
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null | undefined;
  projectPath: string;
  worktreePath: string | null | undefined;
  baseBranch: string;
  currentBranch: string | null | undefined;
}

export function buildIssueRunPrompt({
  issueNumber,
  issueTitle,
  issueBody,
  projectPath,
  worktreePath,
  baseBranch,
  currentBranch,
}: IssueRunPromptContext): string {
  const taskInstructions = issueBody?.trim() || '(empty issue body)';

  return `# GitHub Issue #${issueNumber}: ${issueTitle}

${buildShipCodeRunContract({
  projectPath,
  worktreePath,
  baseBranch,
  currentBranch,
  githubIssueNumber: issueNumber,
})}

## Task Instructions

${taskInstructions}`;
}
