/**
 * GitHub URL helpers derived from a project's `gitRemote`.
 *
 * Covers the three remote forms simple-git / gh will return:
 *   - scp-style:  git@github.com:owner/repo(.git)
 *   - ssh scheme: ssh://git@github.com/owner/repo(.git)
 *   - https:      https://github.com/owner/repo(.git)
 *
 * Rejects non-github.com hosts; host comparison is case-insensitive.
 * All helpers return `null` when the remote is missing or not parseable so
 * callers can gate UI affordances without throwing.
 */

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export function parseGithubRemote(remote: string | null | undefined): GithubRepoRef | null {
  if (!remote) return null;
  const trimmed = remote.trim();

  // scp-style: git@host:owner/repo(.git)
  const scp = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i);
  if (scp && scp[1].toLowerCase() === 'github.com') {
    return { owner: scp[2], repo: scp[3] };
  }

  // URL-parseable forms (ssh://git@... or https://...)
  try {
    const u = new URL(trimmed);
    if (u.hostname.toLowerCase() !== 'github.com') return null;
    const parts = u.pathname
      .replace(/^\/+/, '')
      .replace(/\.git$/i, '')
      .split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

export function githubRepoUrl(remote: string | null | undefined): string | null {
  const ref = parseGithubRemote(remote);
  return ref ? `https://github.com/${ref.owner}/${ref.repo}` : null;
}

export function githubIssuesUrl(remote: string | null | undefined): string | null {
  const base = githubRepoUrl(remote);
  return base ? `${base}/issues` : null;
}

/** GitHub Projects tab for the repo (Projects v2 board list). */
export function githubProjectsUrl(remote: string | null | undefined): string | null {
  const base = githubRepoUrl(remote);
  return base ? `${base}/projects` : null;
}

export function deriveGithubIssueUrl(
  remote: string | null | undefined,
  issueNumber: number,
): string | null {
  const base = githubRepoUrl(remote);
  return base ? `${base}/issues/${issueNumber}` : null;
}
