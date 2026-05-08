import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadForIssueOrExit, parseIssueNumber } from './issue-helpers';

describe('issue helpers', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses numeric issue arguments', () => {
    expect(parseIssueNumber('42')).toBe(42);
  });

  it('exits on invalid issue arguments', () => {
    expect(() => parseIssueNumber('issue-42')).toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number:', 'issue-42');
  });

  it('returns the thread for a project issue', () => {
    const thread = { id: 'thread-1' };
    const ctx = {
      project: { id: 'project-1' },
      threads: {
        getByProjectAndGithubIssue: vi.fn(() => thread),
      },
    };

    expect(getThreadForIssueOrExit(ctx as never, 42)).toBe(thread);
    expect(ctx.threads.getByProjectAndGithubIssue).toHaveBeenCalledWith('project-1', 42);
  });

  it('exits when no thread exists for the issue', () => {
    const ctx = {
      project: { id: 'project-1' },
      threads: {
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

    expect(() => getThreadForIssueOrExit(ctx as never, 42)).toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('No thread found for issue #42 in this project.');
  });
});
