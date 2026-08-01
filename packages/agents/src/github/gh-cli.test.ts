import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
const mockShellEnv = vi.hoisted(() => ({ BUN_INSTALL: '/mock/bun', PATH: '/mock/bin' }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const fn = vi.fn();
  Object.assign(fn, { [promisify.custom]: mockExecFileAsync });
  const mod = {
    exec: vi.fn(),
    execFile: fn,
    execFileSync: vi.fn(() => ''),
    spawn: mockSpawn,
  };
  return { ...mod, default: mod };
});
vi.mock('../health-check', () => ({
  shellExecEnv: () => mockShellEnv,
}));

const ghExecOptions = { cwd: '/test/repo', env: mockShellEnv };
const ghSpawnOptions = { cwd: '/test/repo', env: mockShellEnv, stdio: ['pipe', 'pipe', 'pipe'] };

import { GhCli } from './gh-cli';

/**
 * Create a fake ChildProcess that satisfies the surface `spawnWithStdin` uses:
 * stdout/stderr EventEmitters, an EventEmitter-backed proc for 'error'/'close',
 * and a stdin stub that captures writes. Returns a `complete(code, stderr?)`
 * helper the test can call to drive the promise to resolution/rejection.
 */
function createFakeProc() {
  type FakeStdin = EventEmitter & { write: (chunk: string) => boolean; end: () => void };
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: FakeStdin;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdinWrites: string[] = [];
  let stdinEnded = false;
  // `writeThrows` reproduces a pipe that is already destroyed when we write.
  let writeThrows: Error | null = null;
  const stdin = new EventEmitter() as FakeStdin;
  stdin.write = (chunk: string) => {
    if (writeThrows) throw writeThrows;
    stdinWrites.push(chunk);
    return true;
  };
  stdin.end = () => {
    stdinEnded = true;
  };
  proc.stdin = stdin;
  const complete = (code: number, stderrChunk?: string) => {
    if (stderrChunk !== undefined) proc.stderr.emit('data', stderrChunk);
    proc.emit('close', code);
  };
  const fail = (err: Error) => proc.emit('error', err);
  const failStdin = (err: Error) => proc.stdin.emit('error', err);
  const throwOnWrite = (err: Error) => {
    writeThrows = err;
  };
  return {
    proc,
    stdinWrites,
    isStdinEnded: () => stdinEnded,
    complete,
    fail,
    failStdin,
    throwOnWrite,
  };
}

function success(stdout: string) {
  mockExecFileAsync.mockResolvedValueOnce({ stdout, stderr: '' });
}

function failure(message = 'command failed') {
  mockExecFileAsync.mockRejectedValueOnce(new Error(message));
}

async function waitForSpawnCall(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (mockSpawn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('spawn was not called');
}

describe('GhCli', () => {
  let gh: GhCli;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileAsync.mockReset();
    mockSpawn.mockReset();
    gh = new GhCli('/test/repo');
  });

  describe('repo metadata and labels', () => {
    it('resolves repository metadata, its associated project, and validates required fields', async () => {
      success(
        JSON.stringify({
          id: ' R_123 ',
          nameWithOwner: ' shipshitdev/shipcode ',
          projectsV2: {
            Nodes: [
              {
                title: 'shipcode',
                url: ' https://github.com/orgs/shipshitdev/projects/1 ',
                closed: false,
              },
            ],
          },
        }),
      );

      await expect(gh.getRepoMetadata()).resolves.toEqual({
        githubRepoId: 'R_123',
        githubRepoFullName: 'shipshitdev/shipcode',
        githubProjectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
      });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['repo', 'view', '--json', 'id,nameWithOwner,projectsV2'],
        ghExecOptions,
      );

      success(JSON.stringify({ id: '', nameWithOwner: 'shipshitdev/shipcode' }));
      await expect(gh.getRepoMetadata()).rejects.toThrow(
        'Failed to resolve repository id/name via gh repo view',
      );
    });

    it('prefers the unique open project named after the repository', async () => {
      success(
        JSON.stringify({
          id: 'R_123',
          nameWithOwner: 'acme/widget',
          projectsV2: {
            Nodes: [
              { title: 'Legacy', url: 'https://github.com/orgs/acme/projects/1', closed: true },
              { title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/2', closed: false },
              { title: 'widget', url: 'https://github.com/orgs/acme/projects/3', closed: false },
            ],
          },
        }),
      );

      await expect(gh.getRepoMetadata()).resolves.toMatchObject({
        githubProjectUrl: 'https://github.com/orgs/acme/projects/3',
      });
    });

    it('does not guess when multiple open associated projects are ambiguous', async () => {
      success(
        JSON.stringify({
          id: 'R_123',
          nameWithOwner: 'acme/widget',
          projectsV2: {
            nodes: [
              { title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/2' },
              { title: 'Launch', url: 'https://github.com/orgs/acme/projects/3' },
            ],
          },
        }),
      );

      await expect(gh.getRepoMetadata()).resolves.toMatchObject({ githubProjectUrl: null });
    });

    it('keeps repository identity resolution working without Projects scope', async () => {
      failure('missing read:project scope');
      success(JSON.stringify({ id: 'R_123', nameWithOwner: 'acme/widget' }));

      await expect(gh.getRepoMetadata()).resolves.toEqual({
        githubRepoId: 'R_123',
        githubRepoFullName: 'acme/widget',
        githubProjectUrl: null,
      });
      expect(mockExecFileAsync).toHaveBeenLastCalledWith(
        'gh',
        ['repo', 'view', '--json', 'id,nameWithOwner'],
        ghExecOptions,
      );
    });

    it('lists repository label names and filters missing entries', async () => {
      success(JSON.stringify([{ name: 'bug' }, { name: '' }, {}, { name: 'enhancement' }]));

      await expect(gh.listRepoLabels()).resolves.toEqual(['bug', 'enhancement']);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['label', 'list', '--limit', '200', '--json', 'name'],
        ghExecOptions,
      );
    });
  });

  describe('applyIssueLabelActions', () => {
    it('adds available labels, removes present labels, and reports skipped', async () => {
      // 1) listRepoLabels (filterExistingLabels), 2) getIssue, 3) add edit, 4) remove edit
      success(JSON.stringify([{ name: 'agent:claude' }, { name: 'stale' }]));
      success(
        JSON.stringify({
          number: 9,
          title: 'Bug',
          labels: [{ name: 'stale' }],
          assignees: [],
          state: 'open',
          url: '',
        }),
      );
      success('');
      success('');

      const result = await gh.applyIssueLabelActions(9, {
        addLabels: ['agent:claude', 'ghost'],
        removeLabels: ['stale'],
      });

      expect(result).toEqual({
        added: ['agent:claude'],
        removed: ['stale'],
        skipped: ['ghost'],
      });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '9', '--add-label', 'agent:claude'],
        ghExecOptions,
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '9', '--remove-label', 'stale'],
        ghExecOptions,
      );
    });

    it('does not re-add labels already present on the issue', async () => {
      success(JSON.stringify([{ name: 'agent:claude' }]));
      success(
        JSON.stringify({
          number: 4,
          title: 'x',
          labels: [{ name: 'agent:claude' }],
          assignees: [],
          state: 'open',
          url: '',
        }),
      );

      const result = await gh.applyIssueLabelActions(4, {
        addLabels: ['agent:claude'],
        removeLabels: [],
      });

      expect(result).toEqual({ added: [], removed: [], skipped: [] });
      expect(mockExecFileAsync).not.toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--add-label']),
        ghExecOptions,
      );
    });

    it('dedupes duplicate/blank labels and skips removals absent from the issue', async () => {
      // 1) listRepoLabels (filterExistingLabels), 2) getIssue, 3) add edit
      success(JSON.stringify([{ name: 'agent:claude' }]));
      success(
        JSON.stringify({
          number: 12,
          title: 'Dedup',
          labels: [{ name: 'stale' }],
          assignees: [],
          state: 'open',
          url: '',
        }),
      );
      success('');

      const result = await gh.applyIssueLabelActions(12, {
        // Duplicate + whitespace-only entries collapse to a single unique label.
        addLabels: ['agent:claude', 'agent:claude', '   '],
        // 'ghost' is not present on the issue, so the removal is a no-op.
        removeLabels: ['ghost', 'ghost'],
      });

      expect(result).toEqual({ added: ['agent:claude'], removed: [], skipped: [] });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '12', '--add-label', 'agent:claude'],
        ghExecOptions,
      );
      expect(mockExecFileAsync).not.toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--remove-label']),
        ghExecOptions,
      );
    });
  });

  describe('listIssues', () => {
    it('maps JSON response to GitHubIssue[]', async () => {
      const raw = [
        {
          number: 1,
          title: 'Bug report',
          body: 'Something broke',
          labels: [{ name: 'shipcode:bug' }, { name: 'shipcode:agent:claude' }],
          assignees: [{ login: 'alice' }],
          state: 'OPEN',
          url: 'https://github.com/owner/repo/issues/1',
        },
      ];
      success(JSON.stringify(raw));

      const issues = await gh.listIssues('shipcode:agent:claude');

      expect(issues).toEqual([
        {
          number: 1,
          title: 'Bug report',
          body: 'Something broke',
          labels: ['shipcode:bug', 'shipcode:agent:claude'],
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
          'shipcode:agent:claude',
          '--state',
          'open',
          '--json',
          'number,title,body,labels,assignees,author,state,url',
          '--limit',
          '50',
        ],
        ghExecOptions,
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

    it('uses issue list defaults when optional fields are missing', async () => {
      success(
        JSON.stringify([
          {
            number: 4,
            title: 'Sparse',
            author: { login: 'alice' },
          },
          {
            number: 5,
            title: 'Anonymous',
            author: null,
          },
        ]),
      );

      const issues = await gh.listIssues('sparse');

      expect(issues).toEqual([
        {
          number: 4,
          title: 'Sparse',
          body: null,
          labels: [],
          assignee: null,
          state: 'open',
          url: '',
          author: { login: 'alice' },
        },
        {
          number: 5,
          title: 'Anonymous',
          body: null,
          labels: [],
          assignee: null,
          state: 'open',
          url: '',
          author: undefined,
        },
      ]);
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
          updatedAt: '2026-04-30T08:00:00Z',
        },
      ];
      success(JSON.stringify(raw));

      const issues = await gh.listAllIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].labels).toEqual(['feat']);
      expect(issues[0].updatedAt).toBe('2026-04-30T08:00:00Z');
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--limit', '200']),
        ghExecOptions,
      );
    });

    it('returns empty array for empty response', async () => {
      success('[]');

      const issues = await gh.listAllIssues();
      expect(issues).toEqual([]);
    });

    it('uses list-all defaults when optional fields are missing', async () => {
      success(JSON.stringify([{ number: 11, title: 'Sparse', author: { login: 'bob' } }]));

      const issues = await gh.listAllIssues();

      expect(issues).toEqual([
        {
          number: 11,
          title: 'Sparse',
          body: null,
          labels: [],
          assignee: null,
          state: 'open',
          url: '',
          author: { login: 'bob' },
        },
      ]);
    });
  });

  describe('listAllAgentIssues', () => {
    it('deduplicates by issue number across both labels', async () => {
      const claudeIssues = [
        {
          number: 1,
          title: 'Shared',
          body: '',
          labels: [{ name: 'shipcode:agent:claude' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
        {
          number: 2,
          title: 'Claude only',
          body: '',
          labels: [{ name: 'shipcode:agent:claude' }],
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
          labels: [{ name: 'shipcode:agent:codex' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
        {
          number: 3,
          title: 'Codex only',
          body: '',
          labels: [{ name: 'shipcode:agent:codex' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        },
      ];

      success(JSON.stringify(claudeIssues));
      success(JSON.stringify(codexIssues));
      for (let i = 0; i < 8; i++) success('[]');

      const issues = await gh.listAllAgentIssues();

      expect(issues).toHaveLength(3);
      const numbers = issues.map((i) => i.number);
      expect(numbers).toEqual([1, 2, 3]);
    });

    it('handles one label query failing', async () => {
      failure('shipcode:agent:claude not found');
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
      for (let i = 0; i < 8; i++) success('[]');

      const issues = await gh.listAllAgentIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(5);
    });

    it('handles both failing and returns empty', async () => {
      for (let i = 0; i < 10; i++) failure();

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
        ['issue', 'view', '42', '--json', 'number,title,body,labels,assignees,author,state,url'],
        ghExecOptions,
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

    it('uses issue defaults when optional fields are missing', async () => {
      success(JSON.stringify({ number: 8, title: 'Sparse', author: { login: 'alice' } }));

      const issue = await gh.getIssue(8);

      expect(issue).toEqual({
        number: 8,
        title: 'Sparse',
        body: null,
        labels: [],
        assignee: null,
        state: 'open',
        url: '',
        author: { login: 'alice' },
      });
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

  describe('listPullRequests', () => {
    it('maps pull requests with defaults and linked issues', async () => {
      success(
        JSON.stringify([
          {
            number: 12,
            title: 'Ship it',
            author: { login: 'alice' },
            headRefName: 'ship/12',
            baseRefName: 'main',
            isDraft: false,
            state: 'OPEN',
            reviewDecision: null,
            updatedAt: '2026-05-09T00:00:00Z',
            url: 'https://github.com/o/r/pull/12',
            labels: [{ name: 'ready' }],
            closingIssuesReferences: [{ number: 42 }],
          },
        ]),
      );

      await expect(gh.listPullRequests()).resolves.toEqual([
        {
          number: 12,
          title: 'Ship it',
          author: 'alice',
          headRefName: 'ship/12',
          baseRefName: 'main',
          isDraft: false,
          state: 'OPEN',
          reviewDecision: null,
          updatedAt: '2026-05-09T00:00:00Z',
          url: 'https://github.com/o/r/pull/12',
          labels: ['ready'],
          linkedIssueNumbers: [42],
        },
      ]);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--state', 'open', '--limit', '30']),
        ghExecOptions,
      );
    });

    it('translates merged, closed, and all filters for gh', async () => {
      for (const state of ['merged', 'closed', 'all'] as const) {
        success('[]');
        await gh.listPullRequests({ state, limit: 5 });
      }

      expect(mockExecFileAsync.mock.calls.map((call) => call[1])).toEqual([
        expect.arrayContaining(['--state', 'merged', '--limit', '5']),
        expect.arrayContaining(['--state', 'closed', '--limit', '5']),
        expect.arrayContaining(['--state', 'all', '--limit', '5']),
      ]);
    });

    it('maps nullable PR list fields to defaults', async () => {
      success(
        JSON.stringify([
          {
            number: 13,
            title: 'Sparse PR',
            author: null,
            headRefName: 'ship/13',
            baseRefName: 'main',
            isDraft: false,
            state: 'OPEN',
            reviewDecision: null,
            updatedAt: '2026-05-09T00:00:00Z',
            url: 'https://github.com/o/r/pull/13',
            labels: [],
            closingIssuesReferences: null,
          },
        ]),
      );

      await expect(gh.listPullRequests()).resolves.toMatchObject([
        {
          number: 13,
          author: null,
          labels: [],
          linkedIssueNumbers: [],
        },
      ]);
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
        ghExecOptions,
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
        ghSpawnOptions,
      );
      expect(fake.stdinWrites).toEqual(['New body']);
    });
  });

  describe('submitPrReview', () => {
    it('downgrades self-reviews to comments and pipes the body through stdin', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success('ShipCodeBot\n');
      success(JSON.stringify({ user: { login: 'shipcodebot' }, head: { sha: 'head-sha' } }));
      success(JSON.stringify([[]]));
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);

      const promise = gh.submitPrReview(17, 'request-changes', '---\nreview body');
      await waitForSpawnCall();
      fake.complete(0);

      await expect(promise).resolves.toEqual({
        event: 'comment',
        downgradedForSelfReview: true,
        skippedDuplicate: false,
      });
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['pr', 'review', '17', '--comment', '--body-file', '-'],
        ghSpawnOptions,
      );
      expect(fake.stdinWrites).toEqual(['---\nreview body']);
      expect(fake.isStdinEnded()).toBe(true);
    });

    it('skips an identical review from the same author and head commit', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success('ReviewerBot\n');
      success(JSON.stringify({ user: { login: 'author' }, head: { sha: 'head-sha' } }));
      success(
        JSON.stringify([
          [
            {
              user: { login: 'reviewerbot' },
              commit_id: 'head-sha',
              state: 'APPROVED',
              body: 'looks good',
            },
          ],
        ]),
      );

      await expect(gh.submitPrReview(17, 'approve', 'looks good')).resolves.toEqual({
        event: 'approve',
        downgradedForSelfReview: false,
        skippedDuplicate: true,
      });
      expect(mockSpawn).not.toHaveBeenCalled();
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

      await gh.setIssueLabelPresence(42, 'shipcode:blocked:ci', true);

      expect(mockExecFileAsync).toHaveBeenLastCalledWith(
        'gh',
        ['issue', 'edit', '42', '--add-label', 'shipcode:blocked:ci'],
        ghExecOptions,
      );
    });

    it('removes the label when present', async () => {
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [{ name: 'shipcode:blocked:ci' }],
          assignees: [],
          state: 'OPEN',
          url: 'https://github.com/o/r/issues/42',
        }),
      );
      success('');

      await gh.setIssueLabelPresence(42, 'shipcode:blocked:ci', false);

      expect(mockExecFileAsync).toHaveBeenLastCalledWith(
        'gh',
        ['issue', 'edit', '42', '--remove-label', 'shipcode:blocked:ci'],
        ghExecOptions,
      );
    });

    it('skips no-op label changes and swallows marker sync failures', async () => {
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [{ name: 'present' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        }),
      );

      await gh.setIssueLabelPresence(42, 'present', true);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);

      mockExecFileAsync.mockClear();
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [],
          assignees: [],
          state: 'OPEN',
          url: '',
        }),
      );
      await gh.setIssueLabelPresence(42, 'missing', false);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);

      mockExecFileAsync.mockClear();
      mockExecFileAsync.mockRejectedValueOnce(new Error('issue view failed'));
      mockExecFileAsync.mockRejectedValueOnce(new Error('edit failed'));
      await expect(gh.setIssueLabelPresence(42, 'best-effort', true)).resolves.toBeUndefined();
    });
  });

  describe('editIssue', () => {
    it('writes native milestone and assignees on edit (#45)', async () => {
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);
      // syncIssueLabels runs after the edit spawn; fail its label discovery so
      // the assertion can focus on the edit spawn args.
      mockExecFileAsync.mockRejectedValueOnce(new Error('gh label list failed'));

      const promise = gh.editIssue({
        issueNumber: 42,
        title: 'T',
        body: 'B',
        labels: ['complexity:high'],
        milestone: 'v2.0',
        assignees: ['octocat'],
      });
      fake.complete(0);

      await expect(promise).rejects.toThrow('gh label list failed');
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        [
          'issue',
          'edit',
          '42',
          '--title',
          'T',
          '--body-file',
          '-',
          '--milestone',
          'v2.0',
          '--add-assignee',
          'octocat',
        ],
        ghSpawnOptions,
      );
    });

    it('surfaces label discovery failures instead of clearing managed labels', async () => {
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);
      mockExecFileAsync.mockRejectedValueOnce(new Error('gh label list failed'));

      const promise = gh.editIssue({
        issueNumber: 42,
        title: 'Updated title',
        body: 'Updated body',
        labels: ['shipcode:pipeline:queued'],
      });

      fake.complete(0);

      await expect(promise).rejects.toThrow('gh label list failed');
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--title', 'Updated title', '--body-file', '-'],
        ghSpawnOptions,
      );
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });

    it('edits an issue body and treats missing labels as an empty sync target', async () => {
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);
      success(
        JSON.stringify({
          number: 42,
          title: 'Updated title',
          body: 'Updated body',
          labels: [],
          assignees: [],
          state: 'OPEN',
          url: '',
        }),
      );

      const promise = gh.editIssue({
        issueNumber: 42,
        title: 'Updated title',
        body: 'Updated body',
      });
      fake.complete(0);

      await promise;
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'view', '42', '--json', 'number,title,body,labels,assignees,author,state,url'],
        ghExecOptions,
      );
    });
  });

  describe('createIssue', () => {
    it('writes native milestone and assignees on creation (#45)', async () => {
      success(JSON.stringify([{ name: 'enhancement' }]));
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);
      success(
        JSON.stringify({
          number: 77,
          title: 'Native meta',
          body: 'b',
          labels: [{ name: 'enhancement' }],
          assignees: [{ login: 'octocat' }],
          state: 'OPEN',
          url: 'https://github.com/o/r/issues/77',
        }),
      );

      const promise = gh.createIssue({
        title: 'Native meta',
        body: 'b',
        labels: ['enhancement'],
        milestone: 'v1.0',
        assignees: ['octocat', 'hubot'],
      });
      await waitForSpawnCall();
      fake.proc.stdout.emit('data', 'https://github.com/o/r/issues/77\n');
      fake.complete(0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        [
          'issue',
          'create',
          '--title',
          'Native meta',
          '--body-file',
          '-',
          '--label',
          'enhancement',
          '--milestone',
          'v1.0',
          '--assignee',
          'octocat',
          '--assignee',
          'hubot',
        ],
        ghSpawnOptions,
      );
    });

    it('filters labels, pipes issue body through stdin, and returns the created issue', async () => {
      success(JSON.stringify([{ name: 'enhancement' }, { name: 'bug' }]));
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);
      success(
        JSON.stringify({
          number: 55,
          title: 'New issue',
          body: 'Issue body',
          labels: [{ name: 'enhancement' }],
          assignees: [],
          state: 'OPEN',
          url: 'https://github.com/o/r/issues/55',
        }),
      );

      const promise = gh.createIssue({
        title: 'New issue',
        body: 'Issue body',
        labels: ['enhancement', 'missing'],
      });
      await waitForSpawnCall();
      fake.proc.stdout.emit('data', 'https://github.com/o/r/issues/55\n');
      fake.complete(0);

      await expect(promise).resolves.toMatchObject({ number: 55, labels: ['enhancement'] });
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['issue', 'create', '--title', 'New issue', '--body-file', '-', '--label', 'enhancement'],
        ghSpawnOptions,
      );
      expect(fake.stdinWrites).toEqual(['Issue body']);
    });

    it('throws when created issue output does not include an issue number', async () => {
      success(JSON.stringify([]));
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);

      const promise = gh.createIssue({ title: 'Bad output', body: 'Body' });
      await waitForSpawnCall();
      fake.proc.stdout.emit('data', 'no issue url');
      fake.complete(0);

      await expect(promise).rejects.toThrow('Failed to parse issue number from: no issue url');
    });
  });

  describe('syncIssueLabels', () => {
    it('adds existing requested labels and removes stale managed labels', async () => {
      success(JSON.stringify([{ name: 'enhancement' }, { name: 'complexity:low' }]));
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [
            { name: 'enhancement' },
            { name: 'complexity:high' },
            { name: 'external' },
            { name: 'shipcode:agent:claude' },
          ],
          assignees: [],
          state: 'OPEN',
          url: '',
        }),
      );
      success('');
      success('');

      await gh.syncIssueLabels(42, ['complexity:low'], { removeAgentLabels: true });

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--remove-label', 'enhancement'],
        ghExecOptions,
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--remove-label', 'complexity:high'],
        ghExecOptions,
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--remove-label', 'shipcode:agent:claude'],
        ghExecOptions,
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--add-label', 'complexity:low'],
        ghExecOptions,
      );
    });

    it('handles empty desired labels, issue lookup failure, and best-effort edit failures', async () => {
      mockExecFileAsync.mockRejectedValueOnce(new Error('issue view failed'));

      await expect(gh.syncIssueLabels(42, [])).resolves.toBeUndefined();

      success(JSON.stringify([{ name: 'enhancement' }]));
      success(
        JSON.stringify({
          number: 42,
          title: 'Issue',
          body: '',
          labels: [{ name: 'complexity:high' }],
          assignees: [],
          state: 'OPEN',
          url: '',
        }),
      );
      mockExecFileAsync.mockRejectedValueOnce(new Error('add failed'));

      await expect(gh.syncIssueLabels(42, ['enhancement'])).resolves.toBeUndefined();
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
                state: 'OPEN',
                reviewDecision: 'REVIEW_REQUIRED',
                reviewRequests: { totalCount: 2 },
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
        state: 'OPEN',
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequestCount: 2,
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

    it('throws when GraphQL does not return the pull request', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(JSON.stringify({ data: { repository: { pullRequest: null } } }));

      await expect(gh.getPullRequestFeedback(404)).rejects.toThrow('Pull request #404 not found');
    });

    it('maps fallback check and review thread shapes', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                number: 41,
                url: 'https://github.com/shipshitdev/shipcode/pull/41',
                isDraft: false,
                state: 'OPEN',
                reviewDecision: null,
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              null,
                              {
                                __typename: 'CheckRun',
                                status: 'QUEUED',
                              },
                              {
                                __typename: 'CheckRun',
                                name: 'lint',
                                status: 'COMPLETED',
                                conclusion: 'SKIPPED',
                              },
                              {
                                __typename: 'StatusContext',
                              },
                              {
                                __typename: 'StatusContext',
                                context: 'docs',
                                state: 'SUCCESS',
                              },
                              {
                                __typename: 'StatusContext',
                                context: 'deploy',
                                state: 'PENDING',
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
                    null,
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: { nodes: [{ body: 'missing metadata' }] },
                    },
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            body: 'Actionable',
                            url: 'https://github.com/comment/41',
                            createdAt: '2026-04-14T00:00:00Z',
                            author: { login: null },
                          },
                        ],
                      },
                    },
                    {
                      isResolved: false,
                      isOutdated: true,
                      comments: {
                        nodes: [
                          {
                            body: 'Outdated',
                            url: 'https://github.com/comment/outdated',
                            createdAt: '2026-04-14T00:00:00Z',
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

      const feedback = await gh.getPullRequestFeedback(41);

      expect(feedback).toMatchObject({
        number: 41,
        reviewDecision: null,
        reviewRequestCount: 0,
        ciBlocked: true,
        unresolvedReviewCommentCount: 2,
      });
      expect(feedback.failingChecks).toEqual([
        {
          name: 'status',
          status: 'failed',
          conclusion: null,
          detailsUrl: null,
          workflowName: null,
        },
      ]);
      expect(feedback.unresolvedReviewComments).toEqual([
        {
          author: null,
          body: 'Actionable',
          url: 'https://github.com/comment/41',
          createdAt: '2026-04-14T00:00:00Z',
          path: null,
          line: null,
        },
      ]);
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
        ghExecOptions,
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

    it('rethrows project add errors with empty stderr', async () => {
      const err = {};
      mockExecFileAsync.mockRejectedValueOnce(err);

      await expect(
        gh.addIssueToProject({
          projectNumber: 1,
          owner: 'org',
          issueUrl: 'https://github.com/o/r/issues/1',
        }),
      ).rejects.toBe(err);
    });
  });

  describe('setIssueProjectMetadata', () => {
    it('sets native issue type and project single-select fields', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                id: 'ISSUE_id',
                projectItems: {
                  nodes: [{ id: 'ITEM_id', project: { id: 'PROJECT_id', number: 1 } }],
                },
              },
              issueType: { id: 'TYPE_feature', isEnabled: true },
            },
            organization: {
              projectV2: {
                id: 'PROJECT_id',
                fields: {
                  nodes: [
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'FIELD_status',
                      name: 'Status',
                      options: [{ id: 'OPT_todo', name: 'Todo' }],
                    },
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'FIELD_priority',
                      name: 'Priority',
                      options: [{ id: 'OPT_p3', name: 'P3' }],
                    },
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'FIELD_complexity',
                      name: 'Complexity',
                      options: [{ id: 'OPT_medium', name: 'Medium' }],
                    },
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'FIELD_blast',
                      name: 'Blast radius',
                      options: [{ id: 'OPT_cross_app', name: 'Cross-app' }],
                    },
                  ],
                },
              },
            },
          },
        }),
      );
      success(JSON.stringify({ data: { updateIssueIssueType: { issue: { id: 'ISSUE_id' } } } }));
      success(
        JSON.stringify({
          data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_id' } } },
        }),
      );
      success(
        JSON.stringify({
          data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_id' } } },
        }),
      );
      success(
        JSON.stringify({
          data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_id' } } },
        }),
      );
      success(
        JSON.stringify({
          data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_id' } } },
        }),
      );

      const warnings = await gh.setIssueProjectMetadata({
        issueNumber: 42,
        projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
        metadata: {
          issueType: 'Feature',
          status: 'Todo',
          priority: 'P3',
          complexity: 'medium',
          blastRadius: 'cross-app',
        },
      });

      expect(warnings).toEqual([]);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['repo', 'view', '--json', 'owner,name'],
        ghExecOptions,
      );
      const mutationCalls = mockExecFileAsync.mock.calls
        .map((call) => call[1] as string[])
        .filter((args) => args[0] === 'api' && args[1] === 'graphql')
        .map((args) => args.join(' '));
      expect(mutationCalls.some((args) => args.includes('updateIssueIssueType'))).toBe(true);
      expect(
        mutationCalls.filter((args) => args.includes('updateProjectV2ItemFieldValue')),
      ).toHaveLength(4);
    });

    it('returns a warning when the issue is not attached to the project', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                id: 'ISSUE_id',
                projectItems: { nodes: [] },
              },
              issueType: { id: 'TYPE_feature', isEnabled: true },
            },
            organization: {
              projectV2: {
                id: 'PROJECT_id',
                fields: { nodes: [] },
              },
            },
          },
        }),
      );

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
          metadata: { issueType: 'Feature' },
        }),
      ).resolves.toEqual(['#42: issue is not attached to the configured project']);
    });

    it('returns no warnings for missing project URL or missing GraphQL ids', async () => {
      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: null,
          metadata: { issueType: 'Feature' },
        }),
      ).resolves.toEqual([]);

      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(JSON.stringify({ data: { repository: { issue: null }, user: { projectV2: null } } }));

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/users/decod3rs/projects/2',
          metadata: { issueType: 'Feature' },
        }),
      ).resolves.toEqual([]);
    });

    it('skips optional metadata fields when they are not provided', async () => {
      success(JSON.stringify({ owner: { login: 'decod3rs' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                id: 'ISSUE_id',
                projectItems: {
                  nodes: [{ id: 'ITEM_id', project: { id: 'PROJECT_id', number: 2 } }],
                },
              },
            },
            user: {
              projectV2: {
                id: 'PROJECT_id',
                fields: null,
              },
            },
          },
        }),
      );

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/users/decod3rs/projects/2',
          metadata: {},
        }),
      ).resolves.toEqual([]);

      const graphqlCalls = mockExecFileAsync.mock.calls.filter(
        (call) => (call[1] as string[])[0] === 'api' && (call[1] as string[])[1] === 'graphql',
      );
      expect(graphqlCalls).toHaveLength(1);
    });

    it('clears native issue type and project single-select fields when empty values are provided', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                id: 'ISSUE_id',
                projectItems: {
                  nodes: [{ id: 'ITEM_id', project: { id: 'PROJECT_id', number: 1 } }],
                },
              },
              issueType: null,
            },
            organization: {
              projectV2: {
                id: 'PROJECT_id',
                fields: {
                  nodes: [
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'FIELD_priority',
                      name: 'Priority',
                      options: [{ id: 'OPT_p1', name: 'P1' }],
                    },
                  ],
                },
              },
            },
          },
        }),
      );
      success(JSON.stringify({ data: { updateIssueIssueType: { issue: { id: 'ISSUE_id' } } } }));
      success(
        JSON.stringify({
          data: { clearProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_id' } } },
        }),
      );

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
          metadata: {
            issueType: '',
            priority: '',
          },
        }),
      ).resolves.toEqual([]);

      const mutationCalls = mockExecFileAsync.mock.calls
        .map((call) => call[1] as string[])
        .filter((args) => args[0] === 'api' && args[1] === 'graphql');
      expect(mutationCalls.some((args) => args.join(' ').includes('updateIssueIssueType'))).toBe(
        true,
      );
      expect(mutationCalls.some((args) => args.includes('issueTypeId=null'))).toBe(true);
      expect(
        mutationCalls.some((args) => args.join(' ').includes('clearProjectV2ItemFieldValue')),
      ).toBe(true);
    });

    it('warns for missing issue type, fields, and options', async () => {
      success(JSON.stringify({ owner: { login: 'decod3rs' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                id: 'ISSUE_id',
                projectItems: {
                  nodes: [{ id: 'ITEM_id', project: { id: 'PROJECT_id', number: 2 } }],
                },
              },
              issueType: { id: null, isEnabled: true },
            },
            user: {
              projectV2: {
                id: 'PROJECT_id',
                fields: {
                  nodes: [
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'FIELD_status',
                      name: 'Status',
                      options: [{ id: 'OPT_doing', name: 'Doing' }],
                    },
                  ],
                },
              },
            },
          },
        }),
      );

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/users/decod3rs/projects/2',
          metadata: {
            issueType: 'Feature',
            status: 'todo',
            priority: 'p1',
            complexity: 'medium',
          },
        }),
      ).resolves.toEqual([
        '#42: issue type "Feature" not found',
        '#42: option "Todo" missing for "Status"',
        '#42: project field "Priority" not found',
        '#42: project field "Complexity" not found',
      ]);
    });

    it('throws GraphQL query and mutation errors', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(JSON.stringify({ errors: [{ message: 'query failed' }, {}] }));

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
          metadata: { issueType: 'Feature' },
        }),
      ).rejects.toThrow('GitHub project metadata query failed: query failed; <unknown>');

      mockExecFileAsync.mockClear();
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                id: 'ISSUE_id',
                projectItems: {
                  nodes: [{ id: 'ITEM_id', project: { id: 'PROJECT_id', number: 1 } }],
                },
              },
              issueType: { id: 'TYPE_feature', isEnabled: true },
            },
            organization: {
              projectV2: { id: 'PROJECT_id', fields: { nodes: [] } },
            },
          },
        }),
      );
      success(JSON.stringify({ errors: [{ message: 'mutation failed' }] }));

      await expect(
        gh.setIssueProjectMetadata({
          issueNumber: 42,
          projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
          metadata: { issueType: 'Feature' },
        }),
      ).rejects.toThrow('GitHub GraphQL mutation failed: mutation failed');
    });
  });

  describe('addIssueComment', () => {
    it('calls with correct args and resolves', async () => {
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);

      const promise = gh.addIssueComment(42, 'Hello world');
      fake.complete(0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['issue', 'comment', '42', '--body-file', '-'],
        ghSpawnOptions,
      );
      expect(fake.stdinWrites).toEqual(['Hello world']);
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
        ghExecOptions,
      );
    });
  });

  describe('listRepoLabelsWithMeta', () => {
    it('returns labels with name, color, and description', async () => {
      const raw = [
        { name: 'bug', color: 'd73a4a', description: 'Something is broken.' },
        { name: 'enhancement', color: 'a2eeef', description: 'Feature or product improvement.' },
      ];
      success(JSON.stringify(raw));

      const labels = await gh.listRepoLabelsWithMeta();

      expect(labels).toEqual([
        { name: 'bug', color: 'd73a4a', description: 'Something is broken.' },
        { name: 'enhancement', color: 'a2eeef', description: 'Feature or product improvement.' },
      ]);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        ['label', 'list', '--limit', '200', '--json', 'name,color,description'],
        ghExecOptions,
      );
    });

    it('filters out entries with missing names', async () => {
      const raw = [
        { name: 'bug', color: 'd73a4a', description: 'desc' },
        { name: '', color: 'aaa', description: '' },
        { color: 'bbb', description: 'no name' },
      ];
      success(JSON.stringify(raw));

      const labels = await gh.listRepoLabelsWithMeta();

      expect(labels).toHaveLength(1);
      expect(labels[0].name).toBe('bug');
    });

    it('defaults color and description to empty string when missing', async () => {
      const raw = [{ name: 'test-label' }];
      success(JSON.stringify(raw));

      const labels = await gh.listRepoLabelsWithMeta();

      expect(labels).toEqual([{ name: 'test-label', color: '', description: '' }]);
    });
  });

  describe('createLabel', () => {
    it('calls gh label create with correct args', async () => {
      success('');

      await gh.createLabel({
        name: 'shipcode:agent:claude',
        color: '1f6feb',
        description: 'Route to Claude.',
      });

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'gh',
        [
          'label',
          'create',
          'shipcode:agent:claude',
          '--color',
          '1f6feb',
          '--description',
          'Route to Claude.',
        ],
        ghExecOptions,
      );
    });

    it('treats "already exists" as idempotent success', async () => {
      const err = new Error('exit 1') as Error & { stderr?: string };
      err.stderr = 'label already exists';
      mockExecFileAsync.mockRejectedValueOnce(err);

      await expect(
        gh.createLabel({ name: 'bug', color: 'd73a4a', description: 'desc' }),
      ).resolves.toBeUndefined();
    });

    it('treats duplicate label errors from the Error message as idempotent success', async () => {
      mockExecFileAsync.mockRejectedValueOnce(new Error('Label already exists'));

      await expect(
        gh.createLabel({ name: 'bug', color: 'd73a4a', description: 'desc' }),
      ).resolves.toBeUndefined();
    });

    it('rethrows non-duplicate errors', async () => {
      const err = new Error('exit 1') as Error & { stderr?: string };
      err.stderr = 'authentication required';
      mockExecFileAsync.mockRejectedValueOnce(err);

      await expect(
        gh.createLabel({ name: 'bug', color: 'd73a4a', description: 'desc' }),
      ).rejects.toThrow('exit 1');
    });
  });

  describe('ensureLabels', () => {
    it('creates missing labels and reports already present ones', async () => {
      // listRepoLabels call
      success(JSON.stringify([{ name: 'shipcode:bug' }, { name: 'enhancement' }]));
      // createLabel call for 'shipcode:agent:claude'
      success('');

      const result = await gh.ensureLabels([
        { name: 'shipcode:bug', color: 'd73a4a', description: 'desc' },
        {
          name: 'shipcode:agent:claude',
          color: '1f6feb',
          description: 'Route to Claude.',
        },
      ]);

      expect(result.alreadyPresent).toEqual(['shipcode:bug']);
      expect(result.created).toEqual(['shipcode:agent:claude']);
      expect(result.failed).toEqual([]);
    });

    it('reports failures without throwing', async () => {
      // listRepoLabels
      success(JSON.stringify([]));
      // createLabel fails
      mockExecFileAsync.mockRejectedValueOnce(new Error('rate limited'));

      const result = await gh.ensureLabels([
        { name: 'new-label', color: 'aaa', description: 'desc' },
      ]);

      expect(result.created).toEqual([]);
      expect(result.alreadyPresent).toEqual([]);
      expect(result.failed).toEqual([{ name: 'new-label', error: 'rate limited' }]);
    });

    it('handles mixed success and failure', async () => {
      // listRepoLabels
      success(JSON.stringify([{ name: 'existing' }]));
      // createLabel succeeds for first
      success('');
      // createLabel fails for second
      mockExecFileAsync.mockRejectedValueOnce(new Error('forbidden'));

      const result = await gh.ensureLabels([
        { name: 'existing', color: '111', description: 'a' },
        { name: 'new-ok', color: '222', description: 'b' },
        { name: 'new-fail', color: '333', description: 'c' },
      ]);

      expect(result.alreadyPresent).toEqual(['existing']);
      expect(result.created).toEqual(['new-ok']);
      expect(result.failed).toEqual([{ name: 'new-fail', error: 'forbidden' }]);
    });

    it('returns all as alreadyPresent when nothing is missing', async () => {
      success(JSON.stringify([{ name: 'a' }, { name: 'b' }]));

      const result = await gh.ensureLabels([
        { name: 'a', color: '111', description: 'x' },
        { name: 'b', color: '222', description: 'y' },
      ]);

      expect(result.alreadyPresent).toEqual(['a', 'b']);
      expect(result.created).toEqual([]);
      expect(result.failed).toEqual([]);
      // Only the listRepoLabels call, no createLabel calls
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('listIssueComments', () => {
    function repoCoordinates() {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
    }

    it('maps REST comment fields and author associations', async () => {
      repoCoordinates();
      success(
        JSON.stringify([
          [
            {
              id: 123,
              user: { login: 'alice' },
              body: 'one',
              created_at: '2026-01-01T00:00:00Z',
              html_url: 'https://github.com/o/r/issues/1#issuecomment-123',
              author_association: 'OWNER',
            },
            {
              id: 456,
              user: null,
              body: 'two',
              created_at: '2026-01-01T00:00:00Z',
              html_url: 'https://github.com/o/r/issues/1#issuecomment-456',
              author_association: 'CONTRIBUTOR',
            },
          ],
        ]),
      );

      const comments = await gh.listIssueComments(1);

      expect(comments.map((comment) => comment.id)).toEqual([123, 456]);
      expect(comments[0].author).toBe('alice');
      expect(comments[0].authorAssociation).toBe('OWNER');
      expect(comments[1].author).toBeNull();
      expect(comments[1].authorAssociation).toBe('CONTRIBUTOR');
    });

    it('maps missing issue comment authors to null', async () => {
      repoCoordinates();
      success(
        JSON.stringify([
          [
            {
              id: 123,
              user: {},
              body: 'one',
              created_at: '2026-01-01T00:00:00Z',
              html_url: 'https://github.com/o/r/issues/1#issuecomment-123',
            },
          ],
        ]),
      );

      const comments = await gh.listIssueComments(1);

      expect(comments[0].author).toBeNull();
    });

    it('maps missing issue comment arrays to empty results', async () => {
      repoCoordinates();
      success(JSON.stringify([]));

      const comments = await gh.listIssueComments(1);

      expect(comments).toEqual([]);
    });
  });

  describe('getPullRequestDetail', () => {
    it('maps detail fields, linked issues, failed checks, and unresolved review comments', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                number: 40,
                url: 'https://github.com/shipshitdev/shipcode/pull/40',
                title: 'Ship detail',
                body: null,
                author: null,
                headRefName: 'ship/40',
                baseRefName: 'main',
                isDraft: false,
                state: 'OPEN',
                reviewDecision: null,
                additions: 10,
                deletions: 2,
                changedFiles: 3,
                labels: { nodes: [{ name: 'ready' }, { name: null }] },
                closingIssuesReferences: { nodes: [{ number: 42 }, {}] },
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              {
                                __typename: 'CheckRun',
                                name: 'unit',
                                conclusion: 'FAILURE',
                                status: 'COMPLETED',
                                detailsUrl: null,
                                checkSuite: null,
                              },
                              {
                                __typename: 'StatusContext',
                                context: 'deploy',
                                state: 'PENDING',
                                targetUrl: 'https://github.com/status',
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
                            body: 'first',
                            url: 'https://github.com/comment/1',
                            createdAt: '2026-04-12T00:00:00Z',
                            path: null,
                            line: null,
                            author: null,
                          },
                          {
                            body: 'latest',
                            url: 'https://github.com/comment/2',
                            createdAt: '2026-04-13T00:00:00Z',
                            path: 'packages/agents/src/github/gh-cli.ts',
                            line: 12,
                            author: { login: 'reviewer' },
                          },
                        ],
                      },
                    },
                    {
                      isResolved: true,
                      isOutdated: false,
                      comments: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        }),
      );

      const detail = await gh.getPullRequestDetail(40);

      expect(detail).toMatchObject({
        number: 40,
        title: 'Ship detail',
        body: null,
        author: null,
        headRefName: 'ship/40',
        baseRefName: 'main',
        isDraft: false,
        state: 'OPEN',
        reviewDecision: null,
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        labels: ['ready'],
        linkedIssueNumbers: [42],
        ciBlocked: true,
        unresolvedReviewCommentCount: 1,
      });
      expect(detail.failingChecks).toEqual([
        {
          name: 'unit',
          status: 'failed',
          conclusion: 'failure',
          detailsUrl: null,
          workflowName: null,
        },
      ]);
      expect(detail.unresolvedReviewComments).toEqual([
        {
          author: 'reviewer',
          body: 'latest',
          url: 'https://github.com/comment/2',
          createdAt: '2026-04-13T00:00:00Z',
          path: 'packages/agents/src/github/gh-cli.ts',
          line: 12,
        },
      ]);
    });

    it('throws when GraphQL does not return the pull request', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(JSON.stringify({ data: { repository: { pullRequest: null } } }));

      await expect(gh.getPullRequestDetail(404)).rejects.toThrow('Pull request #404 not found');
    });

    it('maps sparse detail responses with default checks and comments', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                number: 41,
                url: 'https://github.com/shipshitdev/shipcode/pull/41',
                title: 'Sparse detail',
                headRefName: 'ship/41',
                baseRefName: 'main',
                state: 'OPEN',
                additions: 0,
                deletions: 0,
                changedFiles: 0,
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              null,
                              {
                                __typename: 'CheckRun',
                                status: 'IN_PROGRESS',
                              },
                              {
                                __typename: 'CheckRun',
                                name: 'format',
                                status: 'COMPLETED',
                                conclusion: 'NEUTRAL',
                              },
                              {
                                __typename: 'StatusContext',
                                state: 'ERROR',
                              },
                              {
                                __typename: 'StatusContext',
                                context: 'docs',
                                state: 'SUCCESS',
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
                    null,
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: { nodes: [{ url: 'https://github.com/comment/incomplete' }] },
                    },
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            body: 'Needs work',
                            url: 'https://github.com/comment/41',
                            createdAt: '2026-04-14T00:00:00Z',
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

      const detail = await gh.getPullRequestDetail(41);

      expect(detail).toMatchObject({
        number: 41,
        title: 'Sparse detail',
        body: null,
        author: null,
        isDraft: false,
        reviewDecision: null,
        labels: [],
        linkedIssueNumbers: [],
        ciBlocked: true,
        unresolvedReviewCommentCount: 2,
      });
      expect(detail.failingChecks).toEqual([
        {
          name: 'status',
          status: 'failed',
          conclusion: 'error',
          detailsUrl: null,
          workflowName: null,
        },
      ]);
      expect(detail.unresolvedReviewComments).toEqual([
        {
          author: null,
          body: 'Needs work',
          url: 'https://github.com/comment/41',
          createdAt: '2026-04-14T00:00:00Z',
          path: null,
          line: null,
        },
      ]);
    });
  });

  describe('issue comments and state changes', () => {
    it('edits an issue comment through the REST API with stdin JSON', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      const fake = createFakeProc();
      mockSpawn.mockReturnValueOnce(fake.proc);

      const promise = gh.editIssueComment(123, 'Updated body');
      await waitForSpawnCall();
      fake.complete(0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        [
          'api',
          '-X',
          'PATCH',
          'repos/shipshitdev/shipcode/issues/comments/123',
          '-H',
          'Content-Type: application/json',
          '--input',
          '-',
        ],
        ghSpawnOptions,
      );
      expect(fake.stdinWrites).toEqual([JSON.stringify({ body: 'Updated body' })]);
    });

    it('rejects comment edits when repository coordinates are incomplete', async () => {
      success(JSON.stringify({ owner: { login: ' ' }, name: 'shipcode' }));

      await expect(gh.editIssueComment(123, 'Updated body')).rejects.toThrow(
        'Failed to resolve repository owner/name via gh repo view',
      );
    });

    it('upserts issue comments by marker, editing finite database ids and adding otherwise', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify([
          [
            {
              id: 123,
              user: null,
              body: '  <!-- shipcode:plan -->\nold',
              created_at: '2026-01-01T00:00:00Z',
              html_url: 'https://github.com/o/r/issues/1#issuecomment-123',
            },
          ],
        ]),
      );
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      const editProc = createFakeProc();
      mockSpawn.mockReturnValueOnce(editProc.proc);

      const editPromise = gh.upsertIssueCommentByMarker(1, '<!-- shipcode:plan -->', 'new');
      await waitForSpawnCall();
      editProc.complete(0);
      await editPromise;

      expect(mockSpawn).toHaveBeenLastCalledWith(
        'gh',
        expect.arrayContaining(['repos/shipshitdev/shipcode/issues/comments/123']),
        ghSpawnOptions,
      );

      mockExecFileAsync.mockClear();
      mockSpawn.mockClear();
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify([
          [
            {
              id: 456,
              user: null,
              body: 'no marker here',
              created_at: '2026-01-01T00:00:00Z',
              html_url: 'https://github.com/o/r/issues/1#issuecomment-456',
            },
          ],
        ]),
      );
      const addProc = createFakeProc();
      mockSpawn.mockReturnValueOnce(addProc.proc);

      const addPromise = gh.upsertIssueCommentByMarker(1, '<!-- shipcode:plan -->', 'new');
      await waitForSpawnCall();
      addProc.complete(0);
      await addPromise;

      expect(mockSpawn).toHaveBeenLastCalledWith(
        'gh',
        ['issue', 'comment', '1', '--body-file', '-'],
        ghSpawnOptions,
      );
    });

    it('closes and reopens issues with gh issue commands', async () => {
      success('');
      await gh.closeIssue(42);

      success('');
      await gh.reopenIssue(42);

      expect(mockExecFileAsync).toHaveBeenNthCalledWith(
        1,
        'gh',
        ['issue', 'close', '42'],
        ghExecOptions,
      );
      expect(mockExecFileAsync).toHaveBeenNthCalledWith(
        2,
        'gh',
        ['issue', 'reopen', '42'],
        ghExecOptions,
      );
    });
  });

  describe('archiveProjectItems', () => {
    it('archives every project item linked to the issue', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                projectItems: {
                  nodes: [
                    { id: 'ITEM_1', project: { id: 'PROJECT_1' } },
                    { id: 'ITEM_2', project: { id: 'PROJECT_2' } },
                  ],
                },
              },
            },
          },
        }),
      );
      success(JSON.stringify({ data: { archiveProjectV2Item: { item: { id: 'ITEM_1' } } } }));
      success(JSON.stringify({ data: { archiveProjectV2Item: { item: { id: 'ITEM_2' } } } }));

      await gh.archiveProjectItems(42);

      const graphqlCalls = mockExecFileAsync.mock.calls
        .map((call) => call[1] as string[])
        .filter((args) => args[0] === 'api' && args[1] === 'graphql');
      expect(graphqlCalls).toHaveLength(3);
      expect(graphqlCalls[1]).toEqual(expect.arrayContaining(['-F', 'projectId=PROJECT_1']));
      expect(graphqlCalls[1]).toEqual(expect.arrayContaining(['-F', 'itemId=ITEM_1']));
      expect(graphqlCalls[2]).toEqual(expect.arrayContaining(['-F', 'projectId=PROJECT_2']));
      expect(graphqlCalls[2]).toEqual(expect.arrayContaining(['-F', 'itemId=ITEM_2']));
    });

    it('returns without mutations when the issue has no project items', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(
        JSON.stringify({
          data: { repository: { issue: { projectItems: { nodes: [] } } } },
        }),
      );

      await gh.archiveProjectItems(42);

      const graphqlCalls = mockExecFileAsync.mock.calls.filter(
        (call) => (call[1] as string[])[0] === 'api' && (call[1] as string[])[1] === 'graphql',
      );
      expect(graphqlCalls).toHaveLength(1);
    });

    it('returns without mutations when project item data is absent', async () => {
      success(JSON.stringify({ owner: { login: 'shipshitdev' }, name: 'shipcode' }));
      success(JSON.stringify({ data: { repository: { issue: null } } }));

      await gh.archiveProjectItems(42);

      const graphqlCalls = mockExecFileAsync.mock.calls.filter(
        (call) => (call[1] as string[])[0] === 'api' && (call[1] as string[])[1] === 'graphql',
      );
      expect(graphqlCalls).toHaveLength(1);
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
        expect.objectContaining(ghSpawnOptions),
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

  describe('stdin failures', () => {
    it('rejects with the exit code and the stdin error when gh dies mid-write', async () => {
      const { proc, complete, failStdin } = createFakeProc();
      mockSpawn.mockReturnValueOnce(proc);

      const promise = gh.editIssueBody(42, 'body');
      await Promise.resolve();

      // gh exited before draining stdin; without a stdin 'error' listener this
      // would be an unhandled stream error in the main process.
      failStdin(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      complete(1, 'gh: authentication required');

      await expect(promise).rejects.toThrow(/exited with code 1/);
      await expect(promise).rejects.toThrow(/gh: authentication required/);
      await expect(promise).rejects.toThrow(/stdin write failed: write EPIPE/);
    });

    it('resolves when the stdin error is followed by a clean exit', async () => {
      const { proc, complete, failStdin } = createFakeProc();
      mockSpawn.mockReturnValueOnce(proc);

      const promise = gh.addIssueComment(42, 'comment');
      await waitForSpawnCall();

      // A late EPIPE from end()-ing an already-closed pipe must not fail an
      // operation gh reported as successful — these writes are not idempotent.
      failStdin(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      complete(0);

      await expect(promise).resolves.toBeUndefined();
    });

    it('settles once when a stdin error is followed by a process error and close', async () => {
      const { proc, complete, fail, failStdin } = createFakeProc();
      mockSpawn.mockReturnValueOnce(proc);

      const promise = gh.editIssueBody(42, 'body');
      await Promise.resolve();

      failStdin(new Error('write EPIPE'));
      fail(new Error('spawn failed'));
      complete(1, 'ignored, promise already settled');

      await expect(promise).rejects.toThrow('spawn failed');
    });

    it('rejects rather than throwing when the write itself throws', async () => {
      const { proc, complete, throwOnWrite } = createFakeProc();
      throwOnWrite(
        Object.assign(new Error('Cannot call write after a stream was destroyed'), {
          code: 'ERR_STREAM_DESTROYED',
        }),
      );
      mockSpawn.mockReturnValueOnce(proc);

      const promise = gh.editIssueBody(42, 'body');
      await Promise.resolve();

      complete(1, 'gh: rate limit exceeded');

      await expect(promise).rejects.toThrow(/exited with code 1/);
      await expect(promise).rejects.toThrow(/stdin write failed: Cannot call write/);
    });
  });
});
