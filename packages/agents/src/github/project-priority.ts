import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGithubProjectUrl } from '@shipcode/shared';

const execFileAsync = promisify(execFile);

export type PriorityRank = 'p0' | 'p1' | 'p2' | 'p3';

export interface IssuePriority {
  rank: PriorityRank | null;
  raw: string | null;
}

export interface FetchProjectPrioritiesOptions {
  cwd: string;
  projectUrl: string;
  /** Hard cap on pages (defensive against runaway loops). Default 50 (5000 items). */
  maxPages?: number;
  /** Optional structured warn callback so the caller can route to its logger. */
  onWarn?: (message: string, err?: unknown) => void;
}

interface SingleSelectFieldRef {
  name?: string;
}

interface FieldValueNode {
  __typename?: string;
  name?: string;
  field?: SingleSelectFieldRef;
}

interface ProjectItemNode {
  isArchived?: boolean;
  content?: { __typename?: string; number?: number };
  fieldValues?: { nodes?: FieldValueNode[] };
}

interface ProjectV2Response {
  data?: {
    organization?: {
      projectV2?: {
        items?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: ProjectItemNode[];
        };
      } | null;
    } | null;
    user?: {
      projectV2?: {
        items?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: ProjectItemNode[];
        };
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

export function normalizePriorityOption(rawName: string | null | undefined): IssuePriority {
  if (!rawName) return { rank: null, raw: null };
  const trimmed = rawName.trim();
  if (trimmed === '') return { rank: null, raw: null };
  const lower = trimmed.toLowerCase();
  if (lower === 'p0' || lower === 'urgent' || lower === 'critical' || lower === 'highest') {
    return { rank: 'p0', raw: trimmed };
  }
  if (lower === 'p1' || lower === 'high') return { rank: 'p1', raw: trimmed };
  if (lower === 'p2' || lower === 'medium') return { rank: 'p2', raw: trimmed };
  if (lower === 'p3' || lower === 'low' || lower === 'lowest') return { rank: 'p3', raw: trimmed };
  return { rank: null, raw: trimmed };
}

const ORG_QUERY = `
  query($login: String!, $number: Int!, $cursor: String) {
    organization(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isArchived
            content {
              __typename
              ... on Issue { number }
            }
            fieldValues(first: 50) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const USER_QUERY = `
  query($login: String!, $number: Int!, $cursor: String) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isArchived
            content {
              __typename
              ... on Issue { number }
            }
            fieldValues(first: 50) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function isMissingScopeError(message: string): boolean {
  return /insufficient_scopes|read:project|missing.*scope|requires.*scope/i.test(message);
}

/**
 * Fetch GitHub Projects v2 Priority field values for every Issue on the given
 * project board. Returns an empty Map on any error (auth, throttle, schema
 * mismatch, network) so callers can treat priority sync as best-effort —
 * never throws.
 */
export interface FetchProjectPrioritiesResult {
  priorities: Map<number, IssuePriority>;
  /** Issue numbers that are archived on the GitHub Project board. */
  archivedIssueNumbers: Set<number>;
}

export async function fetchProjectPriorities(
  opts: FetchProjectPrioritiesOptions,
): Promise<FetchProjectPrioritiesResult> {
  const result = new Map<number, IssuePriority>();
  const archivedIssueNumbers = new Set<number>();
  const parsed = parseGithubProjectUrl(opts.projectUrl);
  if (!parsed) {
    opts.onWarn?.(`[project-priority] unparseable project URL: ${opts.projectUrl}`);
    return { priorities: result, archivedIssueNumbers };
  }
  const { ownerType, owner, number } = parsed;
  const isOrg = ownerType === 'orgs';
  const query = isOrg ? ORG_QUERY : USER_QUERY;
  const maxPages = opts.maxPages ?? 50;

  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `login=${owner}`,
      '-F',
      `number=${number}`,
    ];
    if (cursor) {
      args.push('-F', `cursor=${cursor}`);
    } else {
      args.push('-F', 'cursor=');
    }

    let stdout: string;
    try {
      const exec = await execFileAsync('gh', args, { cwd: opts.cwd });
      stdout = exec.stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stderr =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: unknown }).stderr ?? '')
          : '';
      const blob = `${message}\n${stderr}`;
      if (isMissingScopeError(blob)) {
        opts.onWarn?.(
          '[project-priority] missing read:project scope — run `gh auth refresh -s read:project` to enable priority sync',
          err,
        );
      } else {
        opts.onWarn?.('[project-priority] gh api graphql failed', err);
      }
      return { priorities: result, archivedIssueNumbers };
    }

    let parsedJson: ProjectV2Response;
    try {
      parsedJson = JSON.parse(stdout) as ProjectV2Response;
    } catch (err) {
      opts.onWarn?.('[project-priority] failed to parse GraphQL response', err);
      return { priorities: result, archivedIssueNumbers };
    }

    if (parsedJson.errors && parsedJson.errors.length > 0) {
      const messages = parsedJson.errors.map((e) => e.message ?? '<unknown>').join('; ');
      opts.onWarn?.(`[project-priority] GraphQL errors: ${messages}`);
      return { priorities: result, archivedIssueNumbers };
    }

    const project = isOrg
      ? parsedJson.data?.organization?.projectV2
      : parsedJson.data?.user?.projectV2;
    if (!project) {
      // Project itself missing or inaccessible — bail with whatever we collected.
      return { priorities: result, archivedIssueNumbers };
    }

    const items = project.items?.nodes ?? [];
    for (const item of items) {
      if (item.content?.__typename !== 'Issue') continue;
      const issueNumber = item.content?.number;
      if (typeof issueNumber !== 'number') continue;
      if (item.isArchived) {
        archivedIssueNumbers.add(issueNumber);
        continue;
      }

      let priorityName: string | null = null;
      const values = item.fieldValues?.nodes ?? [];
      for (const v of values) {
        if (v.__typename !== 'ProjectV2ItemFieldSingleSelectValue') continue;
        const fieldName = v.field?.name ?? '';
        if (!/^priority$/i.test(fieldName)) continue;
        priorityName = v.name ?? null;
        break;
      }

      if (priorityName !== null) {
        result.set(issueNumber, normalizePriorityOption(priorityName));
      }
    }

    const pageInfo = project.items?.pageInfo;
    if (!pageInfo?.hasNextPage) return { priorities: result, archivedIssueNumbers };
    cursor = pageInfo.endCursor ?? null;
    if (!cursor) return { priorities: result, archivedIssueNumbers };
  }

  opts.onWarn?.(`[project-priority] hit page cap of ${maxPages}; truncating priority sync`);
  return { priorities: result, archivedIssueNumbers };
}
