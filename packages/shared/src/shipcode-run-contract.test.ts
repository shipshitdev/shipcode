import { describe, expect, it } from 'vitest';
import { buildShipCodeRunContract } from './shipcode-run-contract';

describe('buildShipCodeRunContract', () => {
  it('renders the shared workspace and rule contract', () => {
    const contract = buildShipCodeRunContract({
      projectPath: '/repo',
      worktreePath: '/worktree',
      baseBranch: 'develop',
      currentBranch: 'shipcode/42-task',
      githubIssueNumber: 42,
      sourceLabel: 'GitHub issue #42',
    });

    expect(contract).toContain('You are working inside ShipCode');
    expect(contract).toContain('- Repo: /repo');
    expect(contract).toContain('- Worktree: /worktree');
    expect(contract).toContain('- Target branch: develop');
    expect(contract).toContain('- Current branch: shipcode/42-task');
    expect(contract).toContain('- GitHub issue: #42');
    expect(contract).toContain('- Do not rename the current branch.');
    expect(contract).toContain('Treat the GitHub issue/PRD below as the source of truth.');
  });
});
