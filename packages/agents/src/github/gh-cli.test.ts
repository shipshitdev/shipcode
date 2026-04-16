import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const fn = vi.fn();
  Object.assign(fn, { [promisify.custom]: mockExecFileAsync });
  return { execFile: fn, spawn: mockSpawn };
});

import { GhCli } from './gh-cli';

/**
 * Create a fake ChildProcess that satisfies the surface `spawnWithStdin` uses:
 * stdout/stderr EventEmitters, an EventEmitter-backed proc for 'error'/'close',
 * and a stdin stub that captures writes. Returns a `complete(code, stderr?)`
 * helper the test can call to drive the promise to resolution/rejection.
 */
function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => boolean; end: () => void };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdinWrites: string[] = [];
  let stdinEnded = false;
  proc.stdin = {
    write: (chunk: string) => {
      stdinWrites.push(chunk);
      return true;
    },
    end: () => {
      stdinEnded = true;
    },
  };
  const complete = (code: number, stderrChunk?: string) => {
    if (stderrChunk !== undefined) proc.stderr.emit('data', stderrChunk);
    proc.emit('close', code);
  };
  const fail = (err: Error) => proc.emit('error', err);
  return { proc, stdinWrites, isStdinEnded: () => stdinEnded, complete, fail };
}

function success(stdout: string) {
  mockExecFileAsync.mockResolvedValueOnce({ stdout, stderr: '' });
}

function failure(message = 'command failed') {
  mockExecFileAsync.mockRejectedValueOnce(new Error(message));
}

describe('GhCli', () => {
  let gh: GhCli;

  beforeEach(() => {
    vi.clearAllMocks();
    gh = new GhCli('/test/repo');
  });

  describe('listIssues', () => {
    it('maps JSON response to GitHubIssue[]', async () => {
      const raw = [
        {
          number: 1,
          title: 'Bug report',
          body: 'Something broke',
          labels: [{ name: 'bug' }, { name: 'agent:claude' }],
          assignees: [{ login: 'alice' }],
          state: 'OPEN',
          url: 'https://github.com/owner/repo/issues/1',
        },
      ];
      success(JSON.stringify(raw));

      const issues = await gh.listIssues('agent:claude');

      expect(issues).toEqual([
        {
          number: 1,
          title: 'Bug report',
          body: 'Something broke',
          labels: ['bug', 'agent:claude'],
          assignee: 'alice',
          state: 'open',
          url: 'https://github.com/owner/repo/issues/1',
        },
      ]);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        [
          'issue',
          'list',
          '--label',
          'agent:claude',
          '--state',
          'open',
          '--json',
          'number,title,body,labels,assignees,state,url',
          '--limit',
          '50',
        ],
        { cwd: '/test/repo' },
      );
    });

    it('returns assignee=null for empty assignees', async () => {
      const raw = [
        {
          number: 2,
          title: 'No assignee',
          body: null,
          labels: [],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
      ];
      success(JSON.stringify(raw));

      const issues = await gh.listIssues('bug');

      expect(issues[0].assignee).toBeNull();
      expect(issues[0].body).toBeNull();
    });

    it('lowercases state', async () => {
      const raw = [
        { number: 3, title: 'T', body: '', labels: [], assignees: [], state: 'CLOSED', url: '' },
      ];
      success(JSON.stringify(raw));

      const issues = await gh.listIssues('x');
      expect(issues[0].state).toBe('closed');
    });
  });

  describe('listAllIssues', () => {
    it('returns mapped issues with --limit 200', async () => {
      const raw = [
        {
          number: 10,
          title: 'All',
          body: 'desc',
          labels: [{ name: 'feat' }],
          assignees: [{ login: 'bob' }],
          state: 'OPEN',
          url: 'https://github.com/o/r/issues/10',
        },
      ];
      success(JSON.stringify(raw));

      const issues = await gh.listAllIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].labels).toEqual(['feat']);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--limit', '200']),
        { cwd: '/test/repo' },
      );
    });

    it('returns empty array for empty response', async () => {
      success('[]');

      const issues = await gh.listAllIssues();
      expect(issues).toEqual([]);
    });
  });

  describe('listAllAgentIssues', () => {
    it('deduplicates by issue number across both labels', async () => {
      const claudeIssues = [
        {
          number: 1,
          title: 'Shared',
          body: '',
          labels: [{ name: 'agent:claude' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
        {
          number: 2,
          title: 'Claude only',
          body: '',
          labels: [{ name: 'agent:claude' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
      ];
      const codexIssues = [
        {
          number: 1,
          title: 'Shared',
          body: '',
          labels: [{ name: 'agent:codex' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
        {
          number: 3,
          title: 'Codex only',
          body: '',
          labels: [{ name: 'agent:codex' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
      ];

      success(JSON.stringify(claudeIssues));
      success(JSON.stringify(codexIssues));

      const issues = await gh.listAllAgentIssues();

      expect(issues).toHaveLength(3);
      const numbers = issues.map((i) => i.number);
      expect(numbers).toEqual([1, 2, 3]);
    });

    it('handles one label query failing', async () => {
      failure('agent:claude not found');
      success(
        JSON.stringify([
          {
            number: 5,
            title: 'Codex',
            body: '',
            labels: [],
            assignees: [],
            state: 'OPEN',
            url: '',
          },
        ]),
      );

      const issues = await gh.listAllAgentIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(5);
    });

    it('handles both failing and returns empty', async () => {
      failure();
      failure();

      const issues = await gh.listAllAgentIssues();
      expect(issues).toEqual([]);
    });
  });

  describe('getIssue', () => {
    it('returns single mapped issue', async () => {
      const raw = {
        number: 42,
        title: 'The issue',
        body: 'Details here',
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'carol' }],
        state: 'OPEN',
        url: 'https://github.com/o/r/issues/42',
      };
      success(JSON.stringify(raw));

      const issue = await gh.getIssue(42);

      expect(issue).toEqual({
        number: 42,
        title: 'The issue',
        body: 'Details here',
        labels: ['bug'],
        assignee: 'carol',
        state: 'open',
        url: 'https://github.com/o/r/issues/42',
      });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'view', '42', '--json', 'number,title,body,labels,assignees,state,url'],
        { cwd: '/test/repo' },
      );
    });

    it('handles null body', async () => {
      const raw = {
        number: 7,
        title: 'No body',
        body: null,
        labels: [],
        assignees: [],
        state: 'OPEN',
        url: '',
      };
      success(JSON.stringify(raw));

      const issue = await gh.getIssue(7);
      expect(issue.body).toBeNull();
    });
  });

  describe('createPR', () => {
    it('extracts PR number from URL', async () => {
      success('https://github.com/owner/repo/pull/7\n');

      const prNumber = await gh.createPR({
        title: 'My PR',
        body: 'PR body',
        head: 'feat/branch',
      });

      expect(prNumber).toBe(7);
      const args = mockExecFileAsync.mock.calls[0][1];
      expect(args).toEqual([
        'pr',
        'create',
        '--title',
        'My PR',
        '--body',
        'PR body',
        '--head',
        'feat/branch',
      ]);
    });

    it('includes --base and --label when provided', async () => {
      success('https://github.com/o/r/pull/99\n');

      await gh.createPR({
        title: 'PR',
        body: 'body',
        head: 'feat/x',
        base: 'main',
        labels: ['review', 'urgent'],
      });

      const args = mockExecFileAsync.mock.calls[0][1];
      expect(args).toContain('--base');
      expect(args).toContain('main');
      expect(args).toContain('--label');
      expect(args).toContain('review,urgent');
    });

    it('throws when URL missing PR number', async () => {
      success('no match here\n');

      await expect(gh.createPR({ title: 'X', body: 'Y', head: 'z' })).rejects.toThrow(
        'Failed to parse PR number from',
      );
    });
  });

  describe('findPullRequestByHead', () => {
    it('returns the first matching PR for a branch head', async () => {
      success(
        JSON.stringify([{ number: 14, url: 'https://github.com/o/r/pull/14', isDraft: true }]),
      );

      const pr = await gh.findPullRequestByHead('feat/branch');

      expect(pr).toEqual({
        number: 14,
        url: 'https://github.com/o/r/pull/14',
        isDraft: true,
      });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'all',
          '--head',
          'feat/branch',
          '--json',
          'number,url,isDraft',
          '--limit',
          '1',
        ],
        { cwd: '/test/repo' },
      );
    });

    it('returns null when there is no matching PR', async () => {
      success('[]');
      await expect(gh.findPullRequestByHead('missing')).resolves.toBeNull();
    });
  });

  describe('updatePullRequest', () => {
    it('pipes the PR body through stdin', async () => {
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);

      const promise = gh.updatePullRequest({
        prNumber: 9,
        title: 'Updated title',
        body: 'New body',
      });

      fake.complete(0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['pr', 'edit', '9', '--title', 'Updated title', '--body-file', '-'],
        { cwd: '/test/repo', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect(fake.stdinWrites).toEqual(['New body']);
    });
  });

  describe('setIssueLabelPresence', () => {
    it('adds the label when missing', async () => {
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [],
          assignees: [],
          state: 'OPEN',
          url: 'https://github.com/o/r/issues/42',
        }),
      );
      success('');

      await gh.setIssueLabelPresence(42, 'blocked:ci', true);

      expect(mockExecFileAsync).toHaveBeenLastCalledWith(
        'gh',
        ['issue', 'edit', '42', '--add-label', 'blocked:ci'],
        { cwd: '/test/repo' },
      );
    });

    it('removes the label when present', async () => {
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [{ name: 'blocked:ci' }],
          assignees: [],
          state: 'OPEN',
          url: 'https://github.com/o/r/issues/42',
        }),
      );
      success('');

      await gh.setIssueLabelPresence(42, 'blocked:ci', false);

      expect(mockExecFileAsync).toHaveBeenLastCalledWith(
        'gh',
        ['issue', 'edit', '42', '--remove-label', 'blocked:ci'],
        { cwd: '/test/repo' },
      );
    });
  });

  describe('editIssue', () => {
    it('surfaces label discovery failures instead of clearing managed labels', async () => {
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);
      mockExecFileAsync.mockRejectedValueOnce(new Error('gh label list failed'));

      const promise = gh.editIssue({
        issueNumber: 42,
        title: 'Updated title',
        body: 'Updated body',
        labels: ['status:queued'],
      });

      fake.complete(0);

      await expect(promise).rejects.toThrow('gh label list failed');
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--title', 'Updated title', '--body-file', '-'],
        { cwd: '/test/repo', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPullRequestFeedback', () => {
    it('maps failing checks and unresolved review threads', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                number: 40,
                url: 'https://github.com/shipshitdev/shipcode/pull/40',
                isDraft: true,
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              {
                                __typename: 'CheckRun',
                                name: 'check',
                                conclusion: 'FAILURE',
                                status: 'COMPLETED',
                                detailsUrl: 'https://github.com/check',
                                checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
                              },
                              {
                                __typename: 'StatusContext',
                                context: 'CodeRabbit',
                                state: 'SUCCESS',
                                targetUrl: null,
                              },
                            ],
                          },
                        },
                      },
                    },
                  ],
                },
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            body: 'Please fix this.',
                            url: 'https://github.com/comment',
                            createdAt: '2026-04-13T00:00:00Z',
                            path: 'apps/desktop/src/main/ipc.ts',
                            line: 123,
                            author: { login: 'chatgpt-codex-connector' },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      );

      const feedback = await gh.getPullRequestFeedback(40);

      expect(feedback).toEqual({
        number: 40,
        url: 'https://github.com/shipshitdev/shipcode/pull/40',
        isDraft: true,
        ciBlocked: true,
        failingChecks: [
          {
            name: 'check',
            status: 'failed',
            conclusion: 'failure',
            detailsUrl: 'https://github.com/check',
            workflowName: 'CI',
          },
        ],
        unresolvedReviewComments: [
          {
            author: 'chatgpt-codex-connector',
            body: 'Please fix this.',
            url: 'https://github.com/comment',
            createdAt: '2026-04-13T00:00:00Z',
            path: 'apps/desktop/src/main/ipc.ts',
            line: 123,
          },
        ],
        unresolvedReviewCommentCount: 1,
      });
    });
  });

  describe('addIssueToProject', () => {
    it('shells `gh project item-add` with the right args and returns added=true', async () => {
      success('');

      const result = await gh.addIssueToProject({
        projectNumber: 1,
        owner: 'shipshitdev',
        issueUrl: 'https://github.com/shipshitdev/shipcode/issues/42',
      });

      expect(result).toEqual({ added: true, alreadyPresent: false });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        [
          'project',
          'item-add',
          '1',
          '--owner',
          'shipshitdev',
          '--url',
          'https://github.com/shipshitdev/shipcode/issues/42',
        ],
        { cwd: '/test/repo' },
      );
    });

    it('treats "already in project" stderr as alreadyPresent (idempotent)', async () => {
      const err = new Error('exit 1') as Error & { stderr?: string };
      err.stderr = 'item already added to project';
      mockExecFileAsync.mockRejectedValueOnce(err);

      const result = await gh.addIssueToProject({
        projectNumber: 1,
        owner: 'shipshitdev',
        issueUrl: 'https://github.com/shipshitdev/shipcode/issues/16',
      });

      expect(result).toEqual({ added: false, alreadyPresent: true });
    });

    it('matches "already in this project" variant', async () => {
      const err = new Error('exit 1') as Error & { stderr?: string };
      err.stderr = 'this issue is already in this project board';
      mockExecFileAsync.mockRejectedValueOnce(err);

      const result = await gh.addIssueToProject({
        projectNumber: 1,
        owner: 'org',
        issueUrl: 'https://github.com/o/r/issues/1',
      });

      expect(result.alreadyPresent).toBe(true);
    });

    it('rethrows non-duplicate errors', async () => {
      const err = new Error('exit 1') as Error & { stderr?: string };
      err.stderr = 'authentication required';
      mockExecFileAsync.mockRejectedValueOnce(err);

      await expect(
        gh.addIssueToProject({
          projectNumber: 1,
          owner: 'org',
          issueUrl: 'https://github.com/o/r/issues/1',
        }),
      ).rejects.toThrow('exit 1');
    });
  });

  describe('addIssueComment', () => {
    it('calls with correct args and resolves', async () => {
      success('');

      await gh.addIssueComment(42, 'Hello world');

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'comment', '42', '--body', 'Hello world'],
        { cwd: '/test/repo' },
      );
    });
  });

  describe('setStatusLabel', () => {
    it('removes existing status:* labels and adds new one', async () => {
      const labelsResponse = {
        labels: [{ name: 'status:queued' }, { name: 'status:in-progress' }, { name: 'bug' }],
      };

      success(JSON.stringify(labelsResponse)); // view
      success(''); // remove status:queued
      success(''); // remove status:in-progress
      success(''); // add new label

      await gh.setStatusLabel(10, 'status:ready-for-review');

      // View call
      expect(mockExecFileAsync.mock.calls[0][1]).toEqual([
        'issue',
        'view',
        '10',
        '--json',
        'labels',
      ]);
      // Remove calls
      expect(mockExecFileAsync.mock.calls[1][1]).toContain('--remove-label');
      expect(mockExecFileAsync.mock.calls[1][1]).toContain('status:queued');
      expect(mockExecFileAsync.mock.calls[2][1]).toContain('--remove-label');
      expect(mockExecFileAsync.mock.calls[2][1]).toContain('status:in-progress');
      // Add call
      expect(mockExecFileAsync.mock.calls[3][1]).toContain('--add-label');
      expect(mockExecFileAsync.mock.calls[3][1]).toContain('status:ready-for-review');
    });

    it('skips removal when no status:* labels exist', async () => {
      const labelsResponse = { labels: [{ name: 'bug' }] };

      success(JSON.stringify(labelsResponse)); // view
      success(''); // add

      await gh.setStatusLabel(5, 'status:queued');

      expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
      expect(mockExecFileAsync.mock.calls[1][1]).toContain('--add-label');
    });

    it('handles fetch failure gracefully and still adds label', async () => {
      failure('view failed'); // view fails
      success(''); // add succeeds

      await gh.setStatusLabel(5, 'status:in-progress');

      expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
      expect(mockExecFileAsync.mock.calls[1][1]).toContain('--add-label');
      expect(mockExecFileAsync.mock.calls[1][1]).toContain('status:in-progress');
    });

    it('handles removal failure and continues', async () => {
      const labelsResponse = { labels: [{ name: 'status:queued' }] };

      success(JSON.stringify(labelsResponse)); // view
      failure('remove failed'); // remove fails
      success(''); // add succeeds

      await gh.setStatusLabel(5, 'status:in-progress');

      expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
      expect(mockExecFileAsync.mock.calls[2][1]).toContain('--add-label');
    });

    it('handles addition failure without throwing', async () => {
      const labelsResponse = { labels: [] };

      success(JSON.stringify(labelsResponse)); // view
      failure('add failed'); // add fails

      await expect(gh.setStatusLabel(5, 'status:queued')).resolves.toBeUndefined();
    });
  });

  describe('getRepoSlug', () => {
    it('returns trimmed nameWithOwner', async () => {
      success('  owner/repo  \n');

      const slug = await gh.getRepoSlug();

      expect(slug).toBe('owner/repo');
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
        { cwd: '/test/repo' },
      );
    });
  });

  describe('editIssueBody', () => {
    it('pipes the body to stdin and resolves on exit 0', async () => {
      const { proc, stdinWrites, isStdinEnded, complete } = createFakeProc();
      mockSpawn.mockReturnValueOnce(proc);

      const body = '## Executive Summary\nEverything is fine.\n';
      const promise = gh.editIssueBody(42, body);

      // Give the event loop a tick so `spawnWithStdin` can attach listeners
      // and write to stdin before we drive the close event.
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--body-file', '-'],
        expect.objectContaining({ cwd: '/test/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
      );
      expect(stdinWrites).toEqual([body]);
      expect(isStdinEnded()).toBe(true);

      complete(0);
      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects with stderr contents on non-zero exit', async () => {
      const { proc, complete } = createFakeProc();
      mockSpawn.mockReturnValueOnce(proc);

      const promise = gh.editIssueBody(7, 'body');
      await Promise.resolve();

      complete(1, 'GraphQL: Could not resolve to an Issue');

      await expect(promise).rejects.toThrow(/exited with code 1/);
      await expect(promise).rejects.toThrow(/GraphQL: Could not resolve to an Issue/);
    });

    it('rejects when the child process emits error', async () => {
      const { proc, fail } = createFakeProc();
      mockSpawn.mockReturnValueOnce(proc);

      const promise = gh.editIssueBody(13, 'body');
      await Promise.resolve();

      fail(new Error('ENOENT'));

      await expect(promise).rejects.toThrow('ENOENT');
    });
  });
});
