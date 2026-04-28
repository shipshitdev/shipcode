export const DEFAULT_BRANCH_FORMAT = 'ship/{id}-{slug}';

export function slugifyIssueTitle(title: string): string {
  return title
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
