import { stripIssueTitlePriorityPrefix } from './github-issue-utils';

/**
 * Every branch ShipCode creates lives under this prefix — issue worktrees
 * (`shipcode/{id}-{slug}`) and non-issue worktrees (`shipcode/{slug}`) alike.
 * Single source of truth: never inline the literal.
 */
export const SHIPCODE_BRANCH_PREFIX = 'shipcode/';

export const DEFAULT_BRANCH_FORMAT = `${SHIPCODE_BRANCH_PREFIX}{id}-{slug}`;

/**
 * Issue worktrees used to be created as `ship/{id}-{slug}`. Existing repos
 * still carry those branches, so recognition has to keep matching them even
 * though nothing creates them any more. The `\d+` guard is what keeps user
 * branches like `ship/my-feature` out of ShipCode-managed listings.
 */
const LEGACY_ISSUE_BRANCH_RE = /^ship\/\d+/;

/**
 * True when a branch is ShipCode-managed: the current `shipcode/` prefix or a
 * legacy `ship/{id}…` issue branch. Used by worktree listing, the cleanup
 * analyzer, and the base-branch selector filter.
 */
export function isShipCodeBranch(name: string): boolean {
  return name.startsWith(SHIPCODE_BRANCH_PREFIX) || LEGACY_ISSUE_BRANCH_RE.test(name);
}

export function slugifyIssueTitle(title: string): string {
  return stripIssueTitlePriorityPrefix(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function formatIssueBranch(
  issueNumber: number,
  title: string,
  format?: string | null,
): string {
  const template = format && format.length > 0 ? format : DEFAULT_BRANCH_FORMAT;
  const slug = slugifyIssueTitle(title);
  return template
    .replace(/\{id\}/g, String(issueNumber))
    .replace(/\{slug\}/g, slug)
    .replace(/-$/, '');
}
