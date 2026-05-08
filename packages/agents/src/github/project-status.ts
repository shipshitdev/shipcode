import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type GhMacroColumn,
  type GhStatusMapping,
  type GhStatusOption,
  parseGithubProjectUrl,
} from '@shipcode/shared';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueGhStatus {
  /** Verbatim option name from GH Projects v2 Status field. */
  raw: string | null;
}

export interface FetchProjectStatusesOptions {
  cwd: string;
  projectUrl: string;
  /**
   * Filter returned statuses to issues belonging to this repo only.
   * Format: `owner/repo` (e.g. `"shipshitdev/shipcode"`).
   * GH Projects v2 boards can contain issues from multiple repos — without
   * this filter, issue numbers from different repos can collide.
   */
  repoFullName?: string;
  /** Hard cap on pages (defensive against runaway loops). Default 50 (5000 items). */
  maxPages?: number;
  /** Optional structured warn callback so the caller can route to its logger. */
  onWarn?: (message: string, err?: unknown) => void;
}

export interface ValidateProjectStatusFieldResult {
  ok: boolean;
  mapping: GhStatusMapping | null;
  availableOptions: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// normalizeStatusOption — maps raw GH Status name to macro column via mapping
// ---------------------------------------------------------------------------

export function normalizeStatusOption(
  raw: string | null | undefined,
  mapping: GhStatusMapping,
): { macroColumn: GhMacroColumn | null; raw: string | null } {
  if (!raw) return { macroColumn: null, raw: null };
  const trimmed = raw.trim();
  if (trimmed === '') return { macroColumn: null, raw: null };
  const lower = trimmed.toLowerCase();

  if (mapping.todo?.name && lower === mapping.todo.name.toLowerCase()) {
    return { macroColumn: 'todo', raw: trimmed };
  }
  if (mapping.inProgress?.name && lower === mapping.inProgress.name.toLowerCase()) {
    return { macroColumn: 'in_progress', raw: trimmed };
  }
  if (mapping.humanReview?.name && lower === mapping.humanReview.name.toLowerCase()) {
    return { macroColumn: 'human_review', raw: trimmed };
  }
  if (mapping.deferred?.name && lower === mapping.deferred.name.toLowerCase()) {
    return { macroColumn: 'deferred', raw: trimmed };
  }
  if (mapping.done?.name && lower === mapping.done.name.toLowerCase()) {
    return { macroColumn: 'done', raw: trimmed };
  }
  return { macroColumn: null, raw: trimmed };
}

// ---------------------------------------------------------------------------
// GraphQL queries — identical structure to project-priority.ts
// ---------------------------------------------------------------------------

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
  content?: {
    __typename?: string;
    number?: number;
    repository?: { nameWithOwner?: string };
  };
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

const ITEMS_ORG_QUERY = `
  query($login: String!, $number: Int!, $cursor: String) {
    organization(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isArchived
            content {
              __typename
              ... on Issue {
                number
                repository { nameWithOwner }
              }
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

const ITEMS_USER_QUERY = `
  query($login: String!, $number: Int!, $cursor: String) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isArchived
            content {
              __typename
              ... on Issue {
                number
                repository { nameWithOwner }
              }
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

// ---------------------------------------------------------------------------
// Validation queries — fetch project Status field options (single call)
// ---------------------------------------------------------------------------

interface FieldOptionNode {
  id: string;
  name: string;
  color?: string | null;
}

interface FieldNode {
  __typename?: string;
  name?: string;
  options?: FieldOptionNode[];
}

interface ProjectFieldsResponse {
  data?: {
    organization?: {
      projectV2?: {
        fields?: { nodes?: FieldNode[] };
      } | null;
    } | null;
    user?: {
      projectV2?: {
        fields?: { nodes?: FieldNode[] };
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

const FIELDS_ORG_QUERY = `
  query($login: String!, $number: Int!) {
    organization(login: $login) {
      projectV2(number: $number) {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              name
              options { id name color }
            }
          }
        }
      }
    }
  }
`;

const FIELDS_USER_QUERY = `
  query($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              name
              options { id name color }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Auto-detection matchers for mapping GH Status option names to macro columns
// ---------------------------------------------------------------------------

const TODO_PATTERN = /^(todo|to[- ]?do|backlog|open|triage)$/i;
const IN_PROGRESS_PATTERN = /^(in[- ]?progress|doing|active|agent[- ]?loop|working|started)$/i;
const HUMAN_REVIEW_PATTERN =
  /^(human[- ]?review|review|needs[- ]?(human|review|attention)|codex[- ]?review|waiting)$/i;
const DEFERRED_PATTERN = /^(deferred|postponed|later|someday)$/i;
const DONE_PATTERN = /^(done|closed|completed|shipped|resolved|merged)$/i;

function isMissingScopeError(message: string): boolean {
  return /insufficient_scopes|read:project|missing.*scope|requires.*scope/i.test(message);
}

// ---------------------------------------------------------------------------
// fetchProjectStatuses — paginated read of Status field values
// ---------------------------------------------------------------------------

/**
 * Fetch GitHub Projects v2 Status field values for every Issue on the given
 * project board. Returns an empty Map on any error — never throws.
 */
export async function fetchProjectStatuses(
  opts: FetchProjectStatusesOptions,
): Promise<Map<number, IssueGhStatus>> {
  const result = new Map<number, IssueGhStatus>();
  const parsed = parseGithubProjectUrl(opts.projectUrl);
  if (!parsed) {
    opts.onWarn?.(`[project-status] unparseable project URL: ${opts.projectUrl}`);
    return result;
  }
  const { ownerType, owner, number } = parsed;
  const isOrg = ownerType === 'orgs';
  const query = isOrg ? ITEMS_ORG_QUERY : ITEMS_USER_QUERY;
  const maxPages = opts.maxPages ?? 50;
  const repoFilter = opts.repoFullName?.toLowerCase() ?? null;

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
          '[project-status] missing read:project scope — run `gh auth refresh -s read:project` to enable status sync',
          err,
        );
      } else {
        opts.onWarn?.('[project-status] gh api graphql failed', err);
      }
      return result;
    }

    let parsedJson: ProjectV2Response;
    try {
      parsedJson = JSON.parse(stdout) as ProjectV2Response;
    } catch (err) {
      opts.onWarn?.('[project-status] failed to parse GraphQL response', err);
      return result;
    }

    if (parsedJson.errors && parsedJson.errors.length > 0) {
      const messages = parsedJson.errors.map((e) => e.message ?? '<unknown>').join('; ');
      opts.onWarn?.(`[project-status] GraphQL errors: ${messages}`);
      return result;
    }

    const project = isOrg
      ? parsedJson.data?.organization?.projectV2
      : parsedJson.data?.user?.projectV2;
    if (!project) return result;

    const items = project.items?.nodes ?? [];
    for (const item of items) {
      if (item.isArchived) continue;
      if (item.content?.__typename !== 'Issue') continue;
      const issueNumber = item.content?.number;
      if (typeof issueNumber !== 'number') continue;

      // Filter by repository when repoFullName is provided — prevents
      // cross-repo issue number collisions on multi-repo project boards.
      if (repoFilter) {
        const itemRepo = item.content?.repository?.nameWithOwner?.toLowerCase();
        if (itemRepo && itemRepo !== repoFilter) continue;
      }

      let statusName: string | null = null;
      const values = item.fieldValues?.nodes ?? [];
      for (const v of values) {
        if (v.__typename !== 'ProjectV2ItemFieldSingleSelectValue') continue;
        const fieldName = v.field?.name ?? '';
        if (!/^status$/i.test(fieldName)) continue;
        statusName = v.name ?? null;
        break;
      }

      if (statusName !== null) {
        result.set(issueNumber, { raw: statusName });
      }
    }

    const pageInfo = project.items?.pageInfo;
    if (!pageInfo?.hasNextPage) return result;
    cursor = pageInfo.endCursor ?? null;
    if (!cursor) return result;
  }

  opts.onWarn?.(`[project-status] hit page cap of ${maxPages}; truncating status sync`);
  return result;
}

// ---------------------------------------------------------------------------
// validateProjectStatusField — onboarding validation of Status field setup
// ---------------------------------------------------------------------------

/**
 * Fetch the Status field options from a GH Projects v2 board and attempt to
 * auto-map them to ShipCode macro columns. Returns `ok: true` when all four
 * macro columns are successfully mapped.
 */
export async function validateProjectStatusField(opts: {
  cwd: string;
  projectUrl: string;
  onWarn?: (message: string, err?: unknown) => void;
}): Promise<ValidateProjectStatusFieldResult> {
  const parsed = parseGithubProjectUrl(opts.projectUrl);
  if (!parsed) {
    return {
      ok: false,
      mapping: null,
      availableOptions: [],
      reason: `unparseable project URL: ${opts.projectUrl}`,
    };
  }

  const { ownerType, owner, number } = parsed;
  const isOrg = ownerType === 'orgs';
  const query = isOrg ? FIELDS_ORG_QUERY : FIELDS_USER_QUERY;

  let stdout: string;
  try {
    const exec = await execFileAsync(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`, '-F', `login=${owner}`, '-F', `number=${number}`],
      { cwd: opts.cwd },
    );
    stdout = exec.stdout;
  } catch (err) {
    opts.onWarn?.('[project-status] validate: gh api graphql failed', err);
    return {
      ok: false,
      mapping: null,
      availableOptions: [],
      reason: 'GraphQL query failed',
    };
  }

  let parsedJson: ProjectFieldsResponse;
  try {
    parsedJson = JSON.parse(stdout) as ProjectFieldsResponse;
  } catch (err) {
    opts.onWarn?.('[project-status] validate: failed to parse GraphQL response', err);
    return {
      ok: false,
      mapping: null,
      availableOptions: [],
      reason: 'invalid JSON response',
    };
  }

  const project = isOrg
    ? parsedJson.data?.organization?.projectV2
    : parsedJson.data?.user?.projectV2;
  if (!project) {
    return {
      ok: false,
      mapping: null,
      availableOptions: [],
      reason: 'project not found or inaccessible',
    };
  }

  const fields = project.fields?.nodes ?? [];
  const statusField = fields.find(
    (f) => f.__typename === 'ProjectV2SingleSelectField' && /^status$/i.test(f.name ?? ''),
  );
  if (!statusField?.options) {
    return {
      ok: false,
      mapping: null,
      availableOptions: [],
      reason: 'no "Status" single-select field found on the project board',
    };
  }

  const availableOptions = statusField.options.map((o) => o.name);

  // Attempt auto-mapping
  let todo: GhStatusOption | null = null;
  let inProgress: GhStatusOption | null = null;
  let humanReview: GhStatusOption | null = null;
  let deferred: GhStatusOption | null = null;
  let done: GhStatusOption | null = null;

  const colorOf = (name: string): string | null =>
    statusField.options?.find((o) => o.name === name)?.color ?? null;

  for (const opt of availableOptions) {
    if (!todo && TODO_PATTERN.test(opt)) todo = { name: opt, color: colorOf(opt) };
    else if (!inProgress && IN_PROGRESS_PATTERN.test(opt))
      inProgress = { name: opt, color: colorOf(opt) };
    else if (!humanReview && HUMAN_REVIEW_PATTERN.test(opt))
      humanReview = { name: opt, color: colorOf(opt) };
    else if (!deferred && DEFERRED_PATTERN.test(opt)) deferred = { name: opt, color: colorOf(opt) };
    else if (!done && DONE_PATTERN.test(opt)) done = { name: opt, color: colorOf(opt) };
  }

  const mapping: GhStatusMapping = { todo, inProgress, humanReview, deferred, done };
  const missing: string[] = [];
  if (!todo) missing.push('todo');
  if (!inProgress) missing.push('inProgress');
  if (!humanReview) missing.push('humanReview');
  if (!done) missing.push('done');
  if (!deferred) missing.push('deferred');

  if (missing.length > 0) {
    return {
      ok: false,
      mapping,
      availableOptions,
      reason: `could not auto-detect mapping for: ${missing.join(', ')}. Available options: ${availableOptions.join(', ')}`,
    };
  }

  return { ok: true, mapping, availableOptions };
}
