import { describe, expect, it, vi } from 'vitest';
import { countTopLevelOperations, githubGraphqlTool } from './github-graphql';
import type { ToolContext } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    worktreePath: '/tmp/wt',
    signal: new AbortController().signal,
    threadId: 't-1',
    ...overrides,
  };
}

const TOKEN = 'ghp_supersecrettoken_DO_NOT_LEAK';

describe('countTopLevelOperations', () => {
  it('counts a single named query', () => {
    expect(countTopLevelOperations('query Q { viewer { login } }')).toBe(1);
  });

  it('counts a single anonymous shorthand', () => {
    expect(countTopLevelOperations('{ viewer { login } }')).toBe(1);
  });

  it('counts a single mutation', () => {
    expect(countTopLevelOperations('mutation M($id:ID!) { archive(id:$id) { ok } }')).toBe(1);
  });

  it('rejects two stacked operations', () => {
    expect(countTopLevelOperations('query A { a } query B { b }')).toBe(2);
  });

  it('rejects mutation + query mix', () => {
    expect(countTopLevelOperations('query A { a } mutation B { b }')).toBe(2);
  });

  it('does not double-count operation keyword inside string literal', () => {
    expect(countTopLevelOperations('query A { hi(s:"mutation X{}") }')).toBe(1);
  });

  it('does not double-count operation keyword in a comment', () => {
    expect(countTopLevelOperations('# mutation Y { y }\nquery A { a }')).toBe(1);
  });

  it('returns 0 on an empty document', () => {
    expect(countTopLevelOperations('')).toBe(0);
    expect(countTopLevelOperations('# only a comment\n')).toBe(0);
  });

  it('handles block strings', () => {
    expect(countTopLevelOperations('query A { hi(s:"""mutation Z {}""") }')).toBe(1);
  });
});

describe('github_graphql tool', () => {
  it('rejects multi-op documents before any network call', async () => {
    const fetchMock = vi.fn();
    const result = await githubGraphqlTool.execute(
      { query: 'query A { a } query B { b }' },
      makeCtx({
        githubGraphql: {
          getToken: () => TOKEN,
          fetch: fetchMock as unknown as typeof fetch,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const env = JSON.parse(result.error) as { error: { code: string; message: string } };
    expect(env.error.code).toBe('multi_op_rejected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty documents as multi_op_rejected (zero ops)', async () => {
    const result = await githubGraphqlTool.execute(
      { query: '# nothing here\n' },
      makeCtx({
        githubGraphql: { getToken: () => TOKEN },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const env = JSON.parse(result.error) as { error: { code: string } };
    expect(env.error.code).toBe('multi_op_rejected');
  });

  it('returns auth_missing when ctx has no githubGraphql deps wired', async () => {
    const result = await githubGraphqlTool.execute({ query: '{ viewer { login } }' }, makeCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const env = JSON.parse(result.error) as { error: { code: string; message: string } };
    expect(env.error.code).toBe('auth_missing');
  });

  it('returns auth_missing when getToken resolves null', async () => {
    const result = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({
        githubGraphql: { getToken: () => null },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const env = JSON.parse(result.error) as { error: { code: string } };
    expect(env.error.code).toBe('auth_missing');
  });

  it('passes query + variables through to the GraphQL endpoint with bearer token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await githubGraphqlTool.execute(
      {
        query: 'query Q($n:Int!){ repository(owner:"o",name:"r"){ issue(number:$n){ title }}}',
        variables: { n: 42 },
      },
      makeCtx({
        githubGraphql: {
          getToken: () => TOKEN,
          fetch: fetchMock as unknown as typeof fetch,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = JSON.parse(result.content) as { data: { viewer: { login: string } } };
    expect(payload.data.viewer.login).toBe('octocat');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({
      query: expect.any(String),
      variables: { n: 42 },
    });
  });

  it('does not echo the bearer token into the success envelope', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { viewer: { login: 'x' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({
        githubGraphql: {
          getToken: () => TOKEN,
          fetch: fetchMock as unknown as typeof fetch,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.includes(TOKEN)).toBe(false);
  });

  it('does not leak the token when the server echoes it back in an error body', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(`Bad credentials: bearer ${TOKEN}`, {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const result = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({
        githubGraphql: {
          getToken: () => TOKEN,
          fetch: fetchMock as unknown as typeof fetch,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.includes(TOKEN)).toBe(false);
    const env = JSON.parse(result.error) as {
      error: { code: string; status?: number; body?: string };
    };
    expect(env.error.code).toBe('auth_missing');
    expect(env.error.status).toBe(401);
    expect((env.error.body ?? '').includes(TOKEN)).toBe(false);
    expect(env.error.body).toContain('***');
  });

  it('reports http_error for non-2xx responses other than 401/403', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('Server Error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const result = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({
        githubGraphql: {
          getToken: () => TOKEN,
          fetch: fetchMock as unknown as typeof fetch,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const env = JSON.parse(result.error) as { error: { code: string; status?: number } };
    expect(env.error.code).toBe('http_error');
    expect(env.error.status).toBe(500);
  });

  it('reports transport error when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const result = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({
        githubGraphql: {
          getToken: () => TOKEN,
          fetch: fetchMock as unknown as typeof fetch,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const env = JSON.parse(result.error) as { error: { code: string; message: string } };
    expect(env.error.code).toBe('transport');
    expect(env.error.message).toContain('ECONNRESET');
  });

  it('reads token at call time (rotation safe)', async () => {
    let nextToken: string | null = 'first';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: { seen: headers.authorization } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const deps = {
      getToken: () => nextToken,
      fetch: fetchMock as unknown as typeof fetch,
    };

    const r1 = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({ githubGraphql: deps }),
    );
    nextToken = 'second';
    const r2 = await githubGraphqlTool.execute(
      { query: '{ viewer { login } }' },
      makeCtx({ githubGraphql: deps }),
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.content).toContain('bearer first');
    expect(r2.content).toContain('bearer second');
  });
});
