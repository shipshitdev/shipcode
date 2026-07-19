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
    expect(mockExecFileAsync.mock.calls[1]?.[1]).toContain('cursor=NEXT_PAGE');
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
    expect(onWarn).toHaveBeenCalledWith(
      '[project-test] hit page cap of 1; truncating test sync',
    );
  });
});
