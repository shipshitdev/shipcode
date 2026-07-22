import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const fn = vi.fn();
  Object.assign(fn, { [promisify.custom]: mockExecFileAsync });
  return { execFile: fn };
});

import { paginateProjectV2Items } from './project-v2-pagination';

const PROJECT_URL = 'https://github.com/orgs/acme/projects/3';

function buildPage(opts: {
  nodes: Array<{ number: number }>;
  hasNextPage?: boolean;
  endCursor?: string | null;
}): string {
  return JSON.stringify({
    data: {
      organization: {
        projectV2: {
          items: {
            nodes: opts.nodes.map(({ number }) => ({
              content: { __typename: 'Issue', number },
            })),
            pageInfo: {
              hasNextPage: opts.hasNextPage ?? false,
              endCursor: opts.endCursor ?? null,
            },
          },
        },
      },
    },
  });
}

describe('paginateProjectV2Items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects every page and forwards the next cursor', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({
        stdout: buildPage({
          nodes: [{ number: 1 }],
          hasNextPage: true,
          endCursor: 'NEXT_PAGE',
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: buildPage({ nodes: [{ number: 2 }] }),
        stderr: '',
      });

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
    });

    expect(items.map((item) => item.content?.number)).toEqual([1, 2]);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
    expect(mockExecFileAsync.mock.calls[0]?.[1]).toContain('cursor=null');
    expect(mockExecFileAsync.mock.calls[1]?.[1]).toContain('cursor=NEXT_PAGE');
    expect(mockExecFileAsync.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ cwd: '/repo', timeout: 30_000 }),
    );
  });

  it('preserves collected pages when a later response is invalid', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({
        stdout: buildPage({
          nodes: [{ number: 1 }],
          hasNextPage: true,
          endCursor: 'NEXT_PAGE',
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'not-json', stderr: '' });
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
      onWarn,
    });

    expect(items.map((item) => item.content?.number)).toEqual([1]);
    expect(onWarn).toHaveBeenCalledWith(
      '[project-test] failed to parse GraphQL response',
      expect.any(SyntaxError),
    );
  });

  it('returns the capped page and emits the caller-specific warning', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({
        nodes: [{ number: 1 }],
        hasNextPage: true,
        endCursor: 'NEXT_PAGE',
      }),
      stderr: '',
    });
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
      maxPages: 1,
      onWarn,
    });

    expect(items.map((item) => item.content?.number)).toEqual([1]);
    expect(onWarn).toHaveBeenCalledWith('[project-test] hit page cap of 1; truncating test sync');
  });

  it('warns and preserves collected pages when gh exits with an error', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('network unavailable'));
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
      onWarn,
    });

    expect(items).toEqual([]);
    expect(onWarn).toHaveBeenCalledWith('[project-test] gh api graphql failed', expect.any(Error));
  });

  it('classifies missing project scope failures', async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      Object.assign(new Error('gh failed'), { stderr: 'insufficient_scopes' }),
    );
    const onWarn = vi.fn();

    await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'status',
      onWarn,
    });

    expect(onWarn).toHaveBeenCalledWith(
      '[project-test] missing read:project scope — run `gh auth refresh -s read:project` to enable status sync',
      expect.any(Error),
    );
  });

  it('warns on GraphQL errors and preserves the current items', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({ errors: [{ message: 'permission denied' }] }),
      stderr: '',
    });
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
      onWarn,
    });

    expect(items).toEqual([]);
    expect(onWarn).toHaveBeenCalledWith('[project-test] GraphQL errors: permission denied');
  });

  it('warns for invalid project URLs without invoking gh', async () => {
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: 'not-a-project-url',
      warningPrefix: 'project-test',
      syncName: 'test',
      onWarn,
    });

    expect(items).toEqual([]);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
    expect(onWarn).toHaveBeenCalledWith(
      '[project-test] unparseable project URL: not-a-project-url',
    );
  });

  it('warns when the requested project is absent', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({ data: { organization: { projectV2: null } } }),
      stderr: '',
    });
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
      onWarn,
    });

    expect(items).toEqual([]);
    expect(onWarn).toHaveBeenCalledWith(`[project-test] project not found: ${PROJECT_URL}`);
  });

  it('warns when a page claims another page without a cursor', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: buildPage({ nodes: [{ number: 1 }], hasNextPage: true, endCursor: null }),
      stderr: '',
    });
    const onWarn = vi.fn();

    const items = await paginateProjectV2Items({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      warningPrefix: 'project-test',
      syncName: 'test',
      onWarn,
    });

    expect(items.map((item) => item.content?.number)).toEqual([1]);
    expect(onWarn).toHaveBeenCalledWith(
      '[project-test] pagination response hasNextPage=true without an endCursor',
    );
  });
});
