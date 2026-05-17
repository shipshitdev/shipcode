/**
 * github_graphql tool — orchestrator-mediated GitHub access.
 *
 * Symphony §10.5: the orchestrator owns the credential and exposes a
 * single repository-scoped `github_graphql({query, variables})` tool.
 * The agent never sees the token, can't rebind to another repo, and
 * can't smuggle multi-op documents past us.
 *
 * Failure shapes (visible to the model in `content` as JSON):
 *   - `{error: {code: 'multi_op_rejected', message}}` — document has
 *     more than one operation definition. Refused before network.
 *   - `{error: {code: 'auth_missing', message}}` — orchestrator did not
 *     wire deps, or the project has no stored GitHub credential.
 *   - `{error: {code: 'http_error', status, message}}` — non-2xx from
 *     api.github.com.
 *   - `{error: {code: 'transport', message}}` — fetch threw / aborted.
 *
 * Success shape: `{data, errors?}` — passed through from GitHub.
 *
 * The token never appears in the result envelope, the error message,
 * or the schema description. Tests in `github-graphql.test.ts` assert
 * the token doesn't leak into either branch.
 */

import { z } from 'zod';
import type { GithubRepoCoords, Tool, ToolContext, ToolResult } from './types';

const GraphqlInput = z.object({
  query: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
  /**
   * Optional repo override. When omitted the tool uses the project's
   * default repo (passed via ctx.githubGraphql.getDefaultRepo). The
   * field is informational — the orchestrator does not rewrite the
   * query — but it lets the caller log/audit which repo the call
   * targets when the document references `$owner`/`$repo`.
   */
  repo: z.object({ owner: z.string().min(1), repo: z.string().min(1) }).optional(),
});

type GraphqlInput = z.infer<typeof GraphqlInput>;

export const githubGraphqlTool: Tool<GraphqlInput> = {
  name: 'github_graphql',
  description:
    'Run a single GraphQL operation against the GitHub API on behalf of the active project. ' +
    'Only read-only active repository queries are allowed; multi-operation documents are rejected. Auth is supplied by the orchestrator; do not ' +
    'attempt to read tokens from the worktree. Returns `{data, errors?}` on success or ' +
    '`{error: {code, message}}` on failure.',
  schema: GraphqlInput,
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description:
          'GraphQL document with exactly one read-only repository query using $owner and $repo variables.',
      },
      variables: {
        type: 'object',
        description: 'Variables map passed through unchanged to GitHub.',
        additionalProperties: true,
      },
      repo: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
        },
        description:
          'Optional explicit repo for telemetry. The query body is not rewritten; pass ' +
          'owner/repo through `variables` when your query needs them.',
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },

  async execute(input: GraphqlInput, ctx: ToolContext): Promise<ToolResult> {
    const opCount = countTopLevelOperations(input.query);
    if (opCount > 1) {
      return errorResult('multi_op_rejected', `expected 1 operation, got ${opCount}`);
    }
    if (opCount === 0) {
      return errorResult('multi_op_rejected', 'no operation definition found');
    }
    if (input.repo) {
      return errorResult(
        'repo_override_rejected',
        'GitHub tool is scoped to the active project repo',
      );
    }
    if (/\b(mutation|subscription)\b/.test(stripCommentsAndStrings(input.query))) {
      return errorResult('operation_rejected', 'Only read-only GitHub GraphQL queries are allowed');
    }

    let defaultRepo: GithubRepoCoords | null = null;
    const deps = ctx.githubGraphql;
    if (!deps) {
      return errorResult('auth_missing', 'Configure GitHub auth in Project Settings');
    }
    if (deps.getDefaultRepo) {
      try {
        defaultRepo = (await deps.getDefaultRepo()) ?? null;
      } catch {
        defaultRepo = null;
      }
    }
    if (!defaultRepo) {
      return errorResult('repo_scope_missing', 'Active project repository is unavailable');
    }

    const scopeError = validateRepoScopedQuery(input.query);
    if (scopeError) return errorResult('query_scope_rejected', scopeError);

    let token: string | null;
    try {
      token = await deps.getToken();
    } catch (err) {
      return errorResult(
        'auth_missing',
        `failed to read GitHub credential: ${(err as Error).message}`,
      );
    }
    if (!token) {
      return errorResult('auth_missing', 'Configure GitHub auth in Project Settings');
    }

    const variables = {
      ...(input.variables ?? {}),
      owner: defaultRepo.owner,
      repo: defaultRepo.repo,
      name: defaultRepo.repo,
    };

    const fetchImpl = deps.fetch ?? fetch;
    const body = JSON.stringify({
      query: input.query,
      variables,
    });

    let response: Response;
    try {
      response = await fetchImpl('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/vnd.github+json',
          'user-agent': 'shipcode-agent',
        },
        body,
        signal: ctx.signal,
      });
    } catch (err) {
      return errorResult('transport', (err as Error).message);
    }

    if (!response.ok) {
      const status = response.status;
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        bodyText = '';
      }
      const code = status === 401 || status === 403 ? 'auth_missing' : 'http_error';
      const msg = code === 'auth_missing' ? 'GitHub rejected the credential' : `status ${status}`;
      return errorResult(code, msg, { status, body: redactToken(bodyText, token) });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      return errorResult('transport', `invalid JSON response: ${(err as Error).message}`);
    }

    return {
      ok: true,
      content: JSON.stringify(payload),
      data: payload,
    };
  },
};

/**
 * Return an envelope-shaped tool error. The model sees the JSON in
 * `content`; the `error` shorthand lives in `error` for the loop's
 * existing telemetry.
 */
function errorResult(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ToolResult {
  const envelope = { error: { code, message, ...extra } };
  return {
    ok: false,
    error: JSON.stringify(envelope),
  };
}

function validateRepoScopedQuery(source: string): string | null {
  const cleaned = stripCommentsAndStrings(source);
  if (/\b(viewer|organization|enterprise|search|nodes?|rateLimit)\s*\(/.test(cleaned)) {
    return 'Only active repository-scoped GitHub queries are allowed';
  }
  if (!/\brepository\s*\(/.test(cleaned)) {
    return 'Query must target the active repository via repository(owner:$owner, name:$repo)';
  }
  if (
    !/\brepository\s*\([^)]*\bowner\s*:\s*\$owner\b[^)]*\b(?:name|repo)\s*:\s*\$(?:repo|name)\b/.test(
      cleaned,
    )
  ) {
    return 'repository query must use orchestrator-owned $owner and $repo variables';
  }
  return null;
}

/**
 * Strip a token substring from a body if it ever leaked into the
 * response (defense in depth — GitHub never echoes the auth header,
 * but a misconfigured proxy might). Cheap; runs only on error paths.
 */
function redactToken(body: string, token: string): string {
  if (!body || !token) return body;
  return body.split(token).join('***');
}

/**
 * Count top-level GraphQL operation definitions. Strips comments
 * (`# … <newline>`) and string literals (single + triple-quoted), then
 * scans for `query|mutation|subscription` (named or anonymous) and
 * the shorthand `{ … }` form when it sits at depth 0.
 *
 * This is a deliberately small scanner — pulling in the `graphql`
 * package costs ~200KB to count braces.
 */
/**
 * Exported for focused scanner tests; production uses it through githubGraphqlTool.
 *
 * @knipignore
 */
export function countTopLevelOperations(source: string): number {
  const cleaned = stripCommentsAndStrings(source);
  let count = 0;
  let depth = 0;
  let i = 0;
  let lastTopOpEnd = 0;
  const len = cleaned.length;

  while (i < len) {
    const ch = cleaned[i];
    if (ch === '{') {
      if (depth === 0) {
        // Shorthand operation `{ … }` — only counts if no named op
        // started on this stretch since the last close.
        const between = cleaned.slice(lastTopOpEnd, i);
        if (!/\b(query|mutation|subscription)\b/.test(between)) {
          count++;
        }
      }
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      if (depth === 0) lastTopOpEnd = i;
      continue;
    }

    if (depth === 0) {
      const m = /^(query|mutation|subscription)\b/.exec(cleaned.slice(i));
      if (m) {
        count++;
        i += m[0].length;
        continue;
      }
    }

    i++;
  }

  return count;
}

function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    // Block string `"""…"""`
    if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      i = end < 0 ? len : end + 3;
      out += '   ';
      continue;
    }
    // Single-line string `"…"` (GraphQL strings cannot span lines).
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '"' || source[j] === '\n') break;
        j++;
      }
      i = j < len ? j + 1 : len;
      out += ' ';
      continue;
    }
    // Comment `# … <newline>`
    if (ch === '#') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? len : nl;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
