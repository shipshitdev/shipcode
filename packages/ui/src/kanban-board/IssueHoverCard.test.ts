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

  it('returns null when the body is missing or strips to empty text', () => {
    expect(issueBodySnippet(makeIssue({ body: null }))).toBeNull();
    expect(
      issueBodySnippet(makeIssue({ body: '<!-- hidden -->\n```ts\nconst x = 1\n```' })),
    ).toBeNull();
  });

  it('falls back to the full automation body when no goal section exists', () => {
    const issue = makeIssue({
      id: 'automation:thread-2',
      issueNumber: -1_000_002,
      body: '# Nightly\n\n- Check `bun test`\n- Report status',
    });

    expect(issueBodySnippet(issue)).toBe('Nightly Check bun test Report status');
  });
});
