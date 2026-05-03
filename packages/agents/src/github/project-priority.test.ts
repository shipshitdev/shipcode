import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const fn = vi.fn();
  Object.assign(fn, { [promisify.custom]: mockExecFileAsync });
  return { execFile: fn, spawn: vi.fn() };
});

import { fetchProjectPriorities, normalizePriorityOption } from './project-priority';

const ORG_URL = 'https://github.com/orgs/acme/projects/3';
const USER_URL = 'https://github.com/users/octocat/projects/7';

interface PageOpts {
  hasNextPage?: boolean;
  endCursor?: string | null;
  nodes: Array<{
    isArchived?: boolean;
    contentType?: string;
    issueNumber?: number;
    priorityName?: string | null;
    extraFieldName?: string;
    extraFieldValue?: string;
  }>;
  ownerType?: 'organization' | 'user';
}

function buildPage(opts: PageOpts): string {
  const ownerType = opts.ownerType ?? 'organization';
  const nodes = opts.nodes.map((n) => ({
    isArchived: n.isArchived ?? false,
    content:
      n.contentType === undefined
        ? { __typename: 'Issue', number: n.issueNumber ?? 0 }
        : n.contentType === 'Issue'
          ? { __typename: 'Issue', number: n.issueNumber ?? 0 }
          : { __typename: n.contentType },
    fieldValues: {
      nodes: [
        ...(n.priorityName !== undefined && n.priorityName !== null
          ? [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                name: n.priorityName,
                field: { name: 'Priority' },
              },
            ]
          : []),
        ...(n.extraFieldName
          ? [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                name: n.extraFieldValue ?? 'Other',
                field: { name: n.extraFieldName },
              },
            ]
          : []),
      ],
    },
  }));

  const projectV2 = {
    items: {
      pageInfo: {
        hasNextPage: opts.hasNextPage ?? false,
        endCursor: opts.endCursor ?? null,
      },
      nodes,
    },
  };

  const data =
    ownerType === 'organization' ? { organization: { projectV2 } } : { user: { projectV2 } };

  return JSON.stringify({ data });
}

describe('normalizePriorityOption', () => {
  it.each([
    ['P0', 'p0'],
    ['p0', 'p0'],
    ['Critical', 'p0'],
    ['Urgent', 'p0'],
    ['Highest', 'p0'],
    ['P1', 'p1'],
    ['High', 'p1'],
    ['P2', 'p2'],
    ['Medium', 'p2'],
    ['P3', 'p3'],
    ['Low', 'p3'],
    ['Lowest', 'p3'],
  ])('%s normalizes to %s', (raw, rank) => {
    const out = normalizePriorityOption(raw);
    expect(out.rank).toBe(rank);
    expect(out.raw).toBe(raw);
  });

  it('preserves raw for unknown options with rank=null', () => {
    expect(normalizePriorityOption('Icebox')).toEqual({ rank: null, raw: 'Icebox' });
  });

  it('returns null/null for empty input', () => {
    expect(normalizePriorityOption(null)).toEqual({ rank: null, raw: null });
    expect(normalizePriorityOption('')).toEqual({ rank: null, raw: null });
    expect(normalizePriorityOption('   ')).toEqual({ rank: null, raw: null });
  });
});

describe('fetchProjectPriorities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses single-page P0/P1/P2/P3 options for org-owned project', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [
          { issueNumber: 1, priorityName: 'P0' },
          { issueNumber: 2, priorityName: 'P1' },
          { issueNumber: 3, priorityName: 'P2' },
          { issueNumber: 4, priorityName: 'P3' },
        ],
      }),
      stderr: '',
    });

    const { priorities: out } = await fetchProjectPriorities({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.get(1)).toEqual({ rank: 'p0', raw: 'P0' });
    expect(out.get(2)).toEqual({ rank: 'p1', raw: 'P1' });
    expect(out.get(3)).toEqual({ rank: 'p2', raw: 'P2' });
    expect(out.get(4)).toEqual({ rank: 'p3', raw: 'P3' });
    expect(out.size).toBe(4);
  });

  it('handles aliased option names case-insensitively', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [
          { issueNumber: 10, priorityName: 'Critical' },
          { issueNumber: 11, priorityName: 'High' },
          { issueNumber: 12, priorityName: 'Medium' },
          { issueNumber: 13, priorityName: 'Low' },
        ],
      }),
      stderr: '',
    });

    const { priorities: out } = await fetchProjectPriorities({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.get(10)?.rank).toBe('p0');
    expect(out.get(11)?.rank).toBe('p1');
    expect(out.get(12)?.rank).toBe('p2');
    expect(out.get(13)?.rank).toBe('p3');
  });

  it('preserves unknown option name with null rank', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [{ issueNumber: 5, priorityName: 'Icebox' }],
      }),
      stderr: '',
    });

    const { priorities: out } = await fetchProjectPriorities({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.get(5)).toEqual({ rank: null, raw: 'Icebox' });
  });

  it('omits issues with no Priority field value (only other fields)', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [
          {
            issueNumber: 99,
            priorityName: null,
            extraFieldName: 'Status',
            extraFieldValue: 'Todo',
          },
        ],
      }),
      stderr: '',
    });

    const { priorities: out } = await fetchProjectPriorities({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.has(99)).toBe(false);
  });

  it('paginates across two pages', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({
        stdout: buildPage({
          hasNextPage: true,
          endCursor: 'CURSOR_2',
          nodes: [{ issueNumber: 1, priorityName: 'P0' }],
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: buildPage({
          nodes: [{ issueNumber: 2, priorityName: 'P1' }],
        }),
        stderr: '',
      });

    const { priorities: out } = await fetchProjectPriorities({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.size).toBe(2);
    expect(out.get(1)?.rank).toBe('p0');
    expect(out.get(2)?.rank).toBe('p1');
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it('excludes archived items', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [
          { issueNumber: 1, priorityName: 'P0', isArchived: true },
          { issueNumber: 2, priorityName: 'P1' },
        ],
      }),
      stderr: '',
    });

    const { priorities: out, archivedIssueNumbers } = await fetchProjectPriorities({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(out.has(1)).toBe(false);
    expect(out.get(2)?.rank).toBe('p1');
    expect(archivedIssueNumbers.has(1)).toBe(true);
    expect(archivedIssueNumbers.has(2)).toBe(false);
  });

  it('excludes draft issues and PRs', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [
          { issueNumber: 1, priorityName: 'P0', contentType: 'DraftIssue' },
          { issueNumber: 2, priorityName: 'P1', contentType: 'PullRequest' },
          { issueNumber: 3, priorityName: 'P2' },
        ],
      }),
      stderr: '',
    });

    const { priorities: out } = await fetchProjectPriorities({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.size).toBe(1);
    expect(out.get(3)?.rank).toBe('p2');
  });

  it('returns empty map on GraphQL error response without throwing', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({ data: null, errors: [{ message: 'project not found' }] }),
      stderr: '',
    });

    const onWarn = vi.fn();
    const { priorities: out } = await fetchProjectPriorities({
      cwd: '/repo',
      projectUrl: ORG_URL,
      onWarn,
    });
    expect(out.size).toBe(0);
    expect(onWarn).toHaveBeenCalled();
  });

  it('returns empty map on exec failure without throwing', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('gh: command failed'));

    const onWarn = vi.fn();
    const { priorities: out } = await fetchProjectPriorities({
      cwd: '/repo',
      projectUrl: ORG_URL,
      onWarn,
    });
    expect(out.size).toBe(0);
    expect(onWarn).toHaveBeenCalled();
  });

  it('detects missing read:project scope', async () => {
    const err: Error & { stderr?: string } = new Error('gh: HTTP 403');
    err.stderr = 'Your token has not been granted the required scopes: read:project';
    mockExecFileAsync.mockRejectedValueOnce(err);

    const onWarn = vi.fn();
    const { priorities: out } = await fetchProjectPriorities({
      cwd: '/repo',
      projectUrl: ORG_URL,
      onWarn,
    });
    expect(out.size).toBe(0);
    expect(onWarn).toHaveBeenCalled();
    const msg = onWarn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('read:project');
  });

  it('uses user(login) form for user-owned project URL', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        ownerType: 'user',
        nodes: [{ issueNumber: 42, priorityName: 'P0' }],
      }),
      stderr: '',
    });

    const { priorities: out } = await fetchProjectPriorities({
      cwd: '/repo',
      projectUrl: USER_URL,
    });
    expect(out.get(42)?.rank).toBe('p0');

    const args = mockExecFileAsync.mock.calls[0]?.[1] as string[];
    const queryArg = args.find((a) => a.startsWith('query=')) ?? '';
    expect(queryArg).toContain('user(login:');
    expect(queryArg).not.toContain('organization(login:');
  });

  it('returns empty map for unparseable project URL', async () => {
    const onWarn = vi.fn();
    const { priorities: out } = await fetchProjectPriorities({
      cwd: '/repo',
      projectUrl: 'https://example.com/not-a-project',
      onWarn,
    });
    expect(out.size).toBe(0);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
    expect(onWarn).toHaveBeenCalled();
  });
});
