import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type GhMacroColumn,
  type GhStatusMapping,
  type GhStatusOption,
  parseGithubProjectUrl,
} from '@shipcode/shared';
import { paginateProjectV2Items } from './project-v2-pagination';

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
  const repoFilter = opts.repoFullName?.toLowerCase() ?? null;
  const items = await paginateProjectV2Items({
    cwd: opts.cwd,
    projectUrl: opts.projectUrl,
    warningPrefix: 'project-status',
    syncName: 'status',
    maxPages: opts.maxPages,
    onWarn: opts.onWarn,
  });

  for (const item of items) {
    if (item.isArchived) continue;
    if (item.content?.__typename !== 'Issue') continue;
    const issueNumber = item.content.number;
    if (typeof issueNumber !== 'number') continue;

    // Filter by repository when repoFullName is provided — prevents
    // cross-repo issue number collisions on multi-repo project boards.
    if (repoFilter) {
      const itemRepo = item.content.repository?.nameWithOwner?.toLowerCase();
      if (itemRepo && itemRepo !== repoFilter) continue;
    }

    let statusName: string | null = null;
    for (const value of item.fieldValues?.nodes ?? []) {
      if (value.__typename !== 'ProjectV2ItemFieldSingleSelectValue') continue;
      if (!/^status$/i.test(value.field?.name ?? '')) continue;
      statusName = value.name ?? null;
      break;
    }

    if (statusName !== null) {
      result.set(issueNumber, { raw: statusName });
    }
  }

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
