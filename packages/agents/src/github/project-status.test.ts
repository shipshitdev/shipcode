import type { GhStatusMapping } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const fn = vi.fn();
  Object.assign(fn, { [promisify.custom]: mockExecFileAsync });
  return { execFile: fn, spawn: vi.fn() };
});

import {
  fetchProjectStatuses,
  normalizeStatusOption,
  validateProjectStatusField,
} from './project-status';

const ORG_URL = 'https://github.com/orgs/acme/projects/3';
const USER_URL = 'https://github.com/users/octocat/projects/7';

const DEFAULT_MAPPING: GhStatusMapping = {
  todo: { name: 'Todo', color: null },
  inProgress: { name: 'In Progress', color: null },
  humanReview: { name: 'Human Review', color: null },
  deferred: { name: 'Deferred', color: null },
  done: { name: 'Done', color: null },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ItemPageOpts {
  hasNextPage?: boolean;
  endCursor?: string | null;
  nodes: Array<{
    isArchived?: boolean;
    contentType?: string;
    issueNumber?: number;
    repoFullName?: string;
    statusName?: string | null;
  }>;
  ownerType?: 'organization' | 'user';
}

function buildItemPage(opts: ItemPageOpts): string {
  const ownerType = opts.ownerType ?? 'organization';
  const nodes = opts.nodes.map((n) => ({
    isArchived: n.isArchived ?? false,
    content:
      n.contentType === undefined
        ? {
            __typename: 'Issue',
            number: n.issueNumber ?? 0,
            ...(n.repoFullName ? { repository: { nameWithOwner: n.repoFullName } } : {}),
          }
        : n.contentType === 'Issue'
          ? {
              __typename: 'Issue',
              number: n.issueNumber ?? 0,
              ...(n.repoFullName ? { repository: { nameWithOwner: n.repoFullName } } : {}),
            }
          : { __typename: n.contentType },
    fieldValues: {
      nodes:
        n.statusName !== undefined && n.statusName !== null
          ? [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                name: n.statusName,
                field: { name: 'Status' },
              },
            ]
          : [],
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

interface FieldsPageOpts {
  statusOptions?: string[];
  statusColors?: (string | null)[];
  ownerType?: 'organization' | 'user';
  noStatusField?: boolean;
}

function buildFieldsPage(opts: FieldsPageOpts): string {
  const ownerType = opts.ownerType ?? 'organization';
  const fields: Array<Record<string, unknown>> = [];

  if (!opts.noStatusField) {
    fields.push({
      __typename: 'ProjectV2SingleSelectField',
      name: 'Status',
      options: (opts.statusOptions ?? []).map((name, i) => ({
        id: `opt_${i}`,
        name,
        color: opts.statusColors?.[i] ?? null,
      })),
    });
  }

  // Add a non-Status field for noise
  fields.push({
    __typename: 'ProjectV2SingleSelectField',
    name: 'Priority',
    options: [
      { id: 'p0', name: 'P0' },
      { id: 'p1', name: 'P1' },
    ],
  });

  const projectV2 = { fields: { nodes: fields } };
  const data =
    ownerType === 'organization' ? { organization: { projectV2 } } : { user: { projectV2 } };
  return JSON.stringify({ data });
}

// ---------------------------------------------------------------------------
// normalizeStatusOption
// ---------------------------------------------------------------------------

describe('normalizeStatusOption', () => {
  it('maps matching option names to correct macro columns', () => {
    expect(normalizeStatusOption('Todo', DEFAULT_MAPPING).macroColumn).toBe('todo');
    expect(normalizeStatusOption('In Progress', DEFAULT_MAPPING).macroColumn).toBe('in_progress');
    expect(normalizeStatusOption('Human Review', DEFAULT_MAPPING).macroColumn).toBe('human_review');
    expect(normalizeStatusOption('Deferred', DEFAULT_MAPPING).macroColumn).toBe('deferred');
    expect(normalizeStatusOption('Done', DEFAULT_MAPPING).macroColumn).toBe('done');
  });

  it('matches case-insensitively', () => {
    expect(normalizeStatusOption('todo', DEFAULT_MAPPING).macroColumn).toBe('todo');
    expect(normalizeStatusOption('TODO', DEFAULT_MAPPING).macroColumn).toBe('todo');
    expect(normalizeStatusOption('in progress', DEFAULT_MAPPING).macroColumn).toBe('in_progress');
    expect(normalizeStatusOption('DONE', DEFAULT_MAPPING).macroColumn).toBe('done');
  });

  it('returns null macroColumn for unmapped options', () => {
    expect(normalizeStatusOption('On Hold', DEFAULT_MAPPING).macroColumn).toBeNull();
    expect(normalizeStatusOption('On Hold', DEFAULT_MAPPING).raw).toBe('On Hold');
  });

  it('handles null/empty input', () => {
    expect(normalizeStatusOption(null, DEFAULT_MAPPING)).toEqual({
      macroColumn: null,
      raw: null,
    });
    expect(normalizeStatusOption('', DEFAULT_MAPPING)).toEqual({
      macroColumn: null,
      raw: null,
    });
    expect(normalizeStatusOption('   ', DEFAULT_MAPPING)).toEqual({
      macroColumn: null,
      raw: null,
    });
  });

  it('handles mapping with null values gracefully', () => {
    const partial: GhStatusMapping = {
      todo: { name: 'Todo', color: null },
      inProgress: null,
      humanReview: null,
      done: { name: 'Done', color: null },
    };
    expect(normalizeStatusOption('In Progress', partial).macroColumn).toBeNull();
    expect(normalizeStatusOption('Todo', partial).macroColumn).toBe('todo');
  });
});

// ---------------------------------------------------------------------------
// fetchProjectStatuses
// ---------------------------------------------------------------------------

describe('fetchProjectStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses single-page Status values for org-owned project', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [
          { issueNumber: 1, statusName: 'Todo' },
          { issueNumber: 2, statusName: 'In Progress' },
          { issueNumber: 3, statusName: 'Done' },
        ],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.get(1)).toEqual({ raw: 'Todo' });
    expect(out.get(2)).toEqual({ raw: 'In Progress' });
    expect(out.get(3)).toEqual({ raw: 'Done' });
    expect(out.size).toBe(3);
  });

  it('uses user(login) form for user-owned project URL', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        ownerType: 'user',
        nodes: [{ issueNumber: 42, statusName: 'Todo' }],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: USER_URL });
    expect(out.get(42)).toEqual({ raw: 'Todo' });

    const args = mockExecFileAsync.mock.calls[0]?.[1] as string[];
    const queryArg = args.find((a: string) => a.startsWith('query=')) ?? '';
    expect(queryArg).toContain('user(login:');
  });

  it('paginates across two pages', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({
        stdout: buildItemPage({
          hasNextPage: true,
          endCursor: 'CURSOR_2',
          nodes: [{ issueNumber: 1, statusName: 'Todo' }],
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: buildItemPage({
          nodes: [{ issueNumber: 2, statusName: 'Done' }],
        }),
        stderr: '',
      });

    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.size).toBe(2);
    expect(out.get(1)?.raw).toBe('Todo');
    expect(out.get(2)?.raw).toBe('Done');
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it('excludes archived items', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [
          { issueNumber: 1, statusName: 'Done', isArchived: true },
          { issueNumber: 2, statusName: 'Todo' },
        ],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.has(1)).toBe(false);
    expect(out.get(2)?.raw).toBe('Todo');
  });

  it('returns empty map on GraphQL error response without throwing', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({ data: null, errors: [{ message: 'project not found' }] }),
      stderr: '',
    });

    const onWarn = vi.fn();
    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL, onWarn });
    expect(out.size).toBe(0);
    expect(onWarn).toHaveBeenCalled();
  });

  it('returns empty map on exec failure without throwing', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('gh: command failed'));

    const onWarn = vi.fn();
    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL, onWarn });
    expect(out.size).toBe(0);
    expect(onWarn).toHaveBeenCalled();
  });

  it('returns empty map for unparseable project URL', async () => {
    const onWarn = vi.fn();
    const out = await fetchProjectStatuses({
      cwd: '/repo',
      projectUrl: 'https://example.com/not-a-project',
      onWarn,
    });
    expect(out.size).toBe(0);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
    expect(onWarn).toHaveBeenCalled();
  });

  it('omits issues with no Status field value', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [{ issueNumber: 99, statusName: null }],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL });
    expect(out.has(99)).toBe(false);
  });

  it('filters issues by repoFullName when provided', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [
          { issueNumber: 12, statusName: 'Done', repoFullName: 'acme/frontend' },
          { issueNumber: 12, statusName: 'Todo', repoFullName: 'acme/backend' },
          { issueNumber: 5, statusName: 'In Progress', repoFullName: 'acme/frontend' },
        ],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({
      cwd: '/repo',
      projectUrl: ORG_URL,
      repoFullName: 'acme/frontend',
    });
    // Issue #12 from acme/frontend (Done), not acme/backend (Todo)
    expect(out.get(12)?.raw).toBe('Done');
    expect(out.get(5)?.raw).toBe('In Progress');
    expect(out.size).toBe(2);
  });

  it('includes issues without repository data when repoFullName filter is set', async () => {
    // Defensive: if GraphQL doesn't return repository info, don't exclude.
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [
          { issueNumber: 7, statusName: 'Todo' }, // no repoFullName
          { issueNumber: 8, statusName: 'Done', repoFullName: 'acme/other' },
        ],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({
      cwd: '/repo',
      projectUrl: ORG_URL,
      repoFullName: 'acme/frontend',
    });
    // #7 has no repo info → included (defensive). #8 is from wrong repo → excluded.
    expect(out.get(7)?.raw).toBe('Todo');
    expect(out.has(8)).toBe(false);
    expect(out.size).toBe(1);
  });

  it('matches repoFullName case-insensitively', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [{ issueNumber: 1, statusName: 'Done', repoFullName: 'Acme/Frontend' }],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({
      cwd: '/repo',
      projectUrl: ORG_URL,
      repoFullName: 'acme/frontend',
    });
    expect(out.get(1)?.raw).toBe('Done');
  });

  it('returns all issues when repoFullName is omitted', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildItemPage({
        nodes: [
          { issueNumber: 12, statusName: 'Done', repoFullName: 'acme/frontend' },
          { issueNumber: 12, statusName: 'Todo', repoFullName: 'acme/backend' },
        ],
      }),
      stderr: '',
    });

    const out = await fetchProjectStatuses({ cwd: '/repo', projectUrl: ORG_URL });
    // Without filter, last write wins (Map.set overwrites) — both are processed.
    // The second #12 (acme/backend, Todo) overwrites the first.
    expect(out.get(12)?.raw).toBe('Todo');
    expect(out.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// validateProjectStatusField
// ---------------------------------------------------------------------------

describe('validateProjectStatusField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok=true with full mapping when all macro columns detected', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildFieldsPage({
        statusOptions: ['Todo', 'In Progress', 'Human Review', 'Done', 'Deferred'],
      }),
      stderr: '',
    });

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(true);
    expect(result.mapping).toEqual({
      todo: { name: 'Todo', color: null },
      inProgress: { name: 'In Progress', color: null },
      humanReview: { name: 'Human Review', color: null },
      done: { name: 'Done', color: null },
      deferred: { name: 'Deferred', color: null },
    });
    expect(result.availableOptions).toEqual([
      'Todo',
      'In Progress',
      'Human Review',
      'Done',
      'Deferred',
    ]);
  });

  it('detects alternative option names', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildFieldsPage({
        statusOptions: ['Backlog', 'Active', 'Review', 'Shipped', 'Later'],
      }),
      stderr: '',
    });

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(true);
    expect(result.mapping).toEqual({
      todo: { name: 'Backlog', color: null },
      inProgress: { name: 'Active', color: null },
      humanReview: { name: 'Review', color: null },
      done: { name: 'Shipped', color: null },
      deferred: { name: 'Later', color: null },
    });
  });

  it('returns ok=false when Status field is absent', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildFieldsPage({ noStatusField: true }),
      stderr: '',
    });

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no "Status" single-select field');
  });

  it('returns ok=false with partial mapping when some columns missing', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildFieldsPage({
        statusOptions: ['Todo', 'Done', 'Deferred'],
      }),
      stderr: '',
    });

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(false);
    expect(result.mapping?.todo).toEqual({ name: 'Todo', color: null });
    expect(result.mapping?.done).toEqual({ name: 'Done', color: null });
    expect(result.mapping?.deferred).toEqual({ name: 'Deferred', color: null });
    expect(result.mapping?.inProgress).toBeNull();
    expect(result.reason).toContain('inProgress');
  });

  it('returns ok=false on exec failure', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('network error'));

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('GraphQL query failed');
  });

  it('returns ok=false for unparseable project URL', async () => {
    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: 'https://example.com/bad',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unparseable');
  });

  it('matches "Codex Review" as human_review', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildFieldsPage({
        statusOptions: ['Todo', 'In Progress', 'Codex Review', 'Done', 'Deferred'],
      }),
      stderr: '',
    });

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(true);
    expect(result.mapping?.humanReview).toEqual({ name: 'Codex Review', color: null });
  });

  it('captures color enum from GitHub status options', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildFieldsPage({
        statusOptions: ['Todo', 'In Progress', 'Human Review', 'Done', 'Deferred'],
        statusColors: ['GREEN', 'YELLOW', 'ORANGE', 'PURPLE', 'GRAY'],
      }),
      stderr: '',
    });

    const result = await validateProjectStatusField({
      cwd: '/repo',
      projectUrl: ORG_URL,
    });
    expect(result.ok).toBe(true);
    expect(result.mapping).toEqual({
      todo: { name: 'Todo', color: 'GREEN' },
      inProgress: { name: 'In Progress', color: 'YELLOW' },
      humanReview: { name: 'Human Review', color: 'ORANGE' },
      done: { name: 'Done', color: 'PURPLE' },
      deferred: { name: 'Deferred', color: 'GRAY' },
    });
  });
});
