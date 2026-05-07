import { describe, expect, it } from 'vitest';
import { issueBodySnippet } from './issue-body-snippet';
import { makeIssue } from './test-helpers';

describe('issueBodySnippet', () => {
  it('uses the goal section for formatted automation prompts', () => {
    const issue = makeIssue({
      id: 'automation:thread-1',
      issueNumber: -1_000_001,
      body: '# Automation: Daily smoke\n\n## Goal\nRun `bun test` and summarize failures.\n\n## Steps\n1. Install deps.\n2. Run tests.',
    });

    expect(issueBodySnippet(issue)).toBe('Run bun test and summarize failures.');
  });

  it('strips markdown noise from regular issue snippets', () => {
    const issue = makeIssue({
      body: '<!-- hidden -->\n## Goal\nShip the [settings panel](https://example.com) with `Save` support.',
    });

    expect(issueBodySnippet(issue)).toBe('Goal Ship the settings panel with Save support.');
  });
});
