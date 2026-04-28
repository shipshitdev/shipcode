export const isRealGithubIssueNumber = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
