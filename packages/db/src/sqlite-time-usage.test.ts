import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const QUERY_DIRECTORY = new URL('./queries/', import.meta.url);
const QUERY_FILES = readdirSync(QUERY_DIRECTORY).filter(
  (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts'),
);
const CANONICAL_TIMESTAMP_QUERIES = [
  'issue-chat-sessions.ts',
  'task-graphs.ts',
  'feature-qa-results.ts',
  'issue-edges.ts',
  'pipeline-steps.ts',
  'review-findings.ts',
  'project-failures.ts',
] as const;

const INLINE_ISO_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

describe('database timestamp SQL', () => {
  it.each(QUERY_FILES)('%s does not duplicate the canonical ISO timestamp fragment', (fileName) => {
    const source = readFileSync(new URL(fileName, QUERY_DIRECTORY), 'utf8');

    expect(source).not.toContain(INLINE_ISO_NOW_SQL);
  });

  it.each(CANONICAL_TIMESTAMP_QUERIES)('%s reuses ISO_NOW_SQL', (fileName) => {
    const source = readFileSync(new URL(fileName, QUERY_DIRECTORY), 'utf8');

    expect(source).toContain('ISO_NOW_SQL');
  });

  it('preserves the non-substitutable stale-claim date modifier', () => {
    const source = readFileSync(new URL('./queries/github-issues.ts', import.meta.url), 'utf8');

    expect(source).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')");
  });
});
