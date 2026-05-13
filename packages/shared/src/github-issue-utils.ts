export const isRealGithubIssueNumber = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

export function stripIssueTitlePriorityPrefix(title: string): string {
  return title
    .replace(/^\s*(?:\[(?:P[0-3])\]\s*(?:[:\-–—]\s*)?|(?:P[0-3])\s*[:\-–—]\s*)/i, '')
    .trim();
}
