import { paginateProjectV2Items } from './project-v2-pagination';

export type PriorityRank = 'p0' | 'p1' | 'p2' | 'p3';

export interface IssuePriority {
  rank: PriorityRank | null;
  raw: string | null;
}

export interface FetchProjectPrioritiesOptions {
  cwd: string;
  projectUrl: string;
  /**
   * Filter returned priorities to issues belonging to this repo only.
   * Format: `owner/repo` (e.g. `"shipshitdev/shipcode"`).
   * GH Projects v2 boards can contain issues from multiple repos, so issue
   * numbers alone are not globally unique.
   */
  repoFullName?: string;
  /** Hard cap on pages (defensive against runaway loops). Default 50 (5000 items). */
  maxPages?: number;
  /** Optional structured warn callback so the caller can route to its logger. */
  onWarn?: (message: string, err?: unknown) => void;
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

/**
 * Fetch GitHub Projects v2 Priority field values for every Issue on the given
 * project board. Returns an empty Map on any error (auth, throttle, schema
 * mismatch, network) so callers can treat priority sync as best-effort —
 * never throws.
 */
export interface FetchProjectPrioritiesResult {
  priorities: Map<number, IssuePriority>;
  issueTypes: Map<number, string | null>;
  /** Issue numbers that are archived on the GitHub Project board. */
  archivedIssueNumbers: Set<number>;
}

export async function fetchProjectPriorities(
  opts: FetchProjectPrioritiesOptions,
): Promise<FetchProjectPrioritiesResult> {
  const result = new Map<number, IssuePriority>();
  const issueTypes = new Map<number, string | null>();
  const archivedIssueNumbers = new Set<number>();
  const repoFilter = opts.repoFullName?.toLowerCase() ?? null;
  const items = await paginateProjectV2Items({
    cwd: opts.cwd,
    projectUrl: opts.projectUrl,
    warningPrefix: 'project-priority',
    syncName: 'priority',
    maxPages: opts.maxPages,
    onWarn: opts.onWarn,
  });

  for (const item of items) {
    if (item.content?.__typename !== 'Issue') continue;
    const issueNumber = item.content.number;
    if (typeof issueNumber !== 'number') continue;
    if (repoFilter) {
      const itemRepo = item.content.repository?.nameWithOwner?.toLowerCase();
      if (itemRepo && itemRepo !== repoFilter) continue;
    }
    if (item.isArchived) {
      archivedIssueNumbers.add(issueNumber);
      continue;
    }
    issueTypes.set(issueNumber, item.content.issueType?.name ?? null);

    let priorityName: string | null = null;
    for (const value of item.fieldValues?.nodes ?? []) {
      if (value.__typename !== 'ProjectV2ItemFieldSingleSelectValue') continue;
      if (!/^priority$/i.test(value.field?.name ?? '')) continue;
      priorityName = value.name ?? null;
      break;
    }

    if (priorityName !== null) {
      result.set(issueNumber, normalizePriorityOption(priorityName));
    }
  }

  return { priorities: result, issueTypes, archivedIssueNumbers };
}
