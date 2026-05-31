import { describe, expect, it } from 'vitest';
import { buildIssueRunPrompt } from './issue-run-prompt';

describe('buildIssueRunPrompt', () => {
  it('wraps GitHub issue instructions in the ShipCode workspace contract', () => {
    const prompt = buildIssueRunPrompt({
      issueNumber: 42,
      issueTitle: 'Add import flow',
      issueBody: '# PRD: import-flow\n\n## Goals\n- Import CSV files',
      projectPath: '/repo',
      worktreePath: '/worktrees/repo/42',
      baseBranch: 'develop',
      currentBranch: 'shipcode/42-add-import-flow',
    });

    expect(prompt).toContain('# GitHub Issue #42: Add import flow');
    expect(prompt).toContain('- Repo: /repo');
    expect(prompt).toContain('- Worktree: /worktrees/repo/42');
    expect(prompt).toContain('- Target branch: develop');
    expect(prompt).toContain('- Current branch: shipcode/42-add-import-flow');
    expect(prompt).toContain('- Do not rename the current branch.');
    expect(prompt).toContain('Treat the GitHub issue/PRD below as the source of truth.');
    expect(prompt).toContain('# PRD: import-flow');
  });

  it('uses the repo path as the effective worktree before a worktree is assigned', () => {
    const prompt = buildIssueRunPrompt({
      issueNumber: 7,
      issueTitle: 'Fix startup',
      issueBody: 'Fix the crash.',
      projectPath: '/repo',
      worktreePath: null,
      baseBranch: 'main',
      currentBranch: null,
    });

    expect(prompt).toContain('- Worktree: /repo');
    expect(prompt).toContain('- Current branch: (current worktree branch)');
    expect(prompt).toContain('Fix the crash.');
  });

  it('keeps empty issue bodies explicit', () => {
    const prompt = buildIssueRunPrompt({
      issueNumber: 3,
      issueTitle: 'Blank',
      issueBody: '   ',
      projectPath: '/repo',
      worktreePath: '/worktree',
      baseBranch: 'develop',
      currentBranch: 'shipcode/3-blank',
    });

    expect(prompt).toContain('(empty issue body)');
  });
});
