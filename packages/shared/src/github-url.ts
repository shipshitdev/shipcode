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

function parseGithubHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function parseGithubUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function githubPathParts(url: URL, options: { stripGitSuffix?: boolean } = {}): string[] {
  const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return (options.stripGitSuffix ? path.replace(/\.git$/i, '') : path).split('/');
}

export function parseGithubRemote(remote: string | null | undefined): GithubRepoRef | null {
  if (!remote) return null;
  const trimmed = remote.trim();

  // scp-style: git@host:owner/repo(.git)
  const scp = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i);
  if (scp && scp[1].toLowerCase() === 'github.com') {
    return { owner: scp[2], repo: scp[3] };
  }

  const url = parseGithubUrl(trimmed);
  if (!url) return null;

  const parts = githubPathParts(url, { stripGitSuffix: true });
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function githubRepoUrl(remote: string | null | undefined): string | null {
  const ref = parseGithubRemote(remote);
  return ref ? `https://github.com/${ref.owner}/${ref.repo}` : null;
}

export function githubIssuesUrl(remote: string | null | undefined): string | null {
  const base = githubRepoUrl(remote);
  return base ? `${base}/issues` : null;
}

/**
 * GitHub Projects URL helper.
 *
 * - If a non-empty `override` is provided (a per-project GitHub Projects v2
 *   URL), return it verbatim (trimmed). This is the user's hand-picked board.
 * - Otherwise fall back to `${repoBase}/projects` — the repo's Projects tab,
 *   which lists any Projects v2 boards linked to this repo.
 * - Returns `null` when neither an override nor a parseable remote is available,
 *   so callers can gate the UI affordance.
 */
export function githubProjectsUrl(
  remote: string | null | undefined,
  override?: string | null,
): string | null {
  if (override?.trim()) return override.trim();
  const base = githubRepoUrl(remote);
  return base ? `${base}/projects` : null;
}

export type GithubProjectUrlValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

/**
 * Validate a user-supplied GitHub Projects v2 URL override.
 *
 * Accepted shapes (case-insensitive on host):
 *   - `null` / `''` / whitespace-only → clears the override (`{ok, value: null}`)
 *   - `https://github.com/orgs/<org>/projects/<n>`
 *   - `https://github.com/users/<user>/projects/<n>`
 *   - `https://github.com/<owner>/<repo>/projects/<n>` (legacy classic)
 *
 * Rejects non-https, non-github.com hosts, and any github.com path that
 * doesn't match one of the three shapes above. The reason string is safe
 * to surface in the modal and short enough for the IPC clamp helper.
 */
export function validateGithubProjectUrl(
  raw: string | null | undefined,
): GithubProjectUrlValidation {
  if (raw == null || raw.trim() === '') return { ok: true, value: null };
  const trimmed = raw.trim();

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }

  if (u.protocol !== 'https:') {
    return { ok: false, reason: 'URL must start with https://' };
  }
  if (u.hostname.toLowerCase() !== 'github.com') {
    return { ok: false, reason: 'Host must be github.com' };
  }

  const parts = githubPathParts(u);
  // orgs/<org>/projects/<n>
  if (
    parts.length >= 4 &&
    (parts[0] === 'orgs' || parts[0] === 'users') &&
    parts[2] === 'projects'
  ) {
    if (!/^\d+$/.test(parts[3])) {
      return { ok: false, reason: 'Project number must be numeric' };
    }
    return { ok: true, value: trimmed };
  }
  // <owner>/<repo>/projects/<n> (classic repo-scoped project)
  if (parts.length >= 4 && parts[2] === 'projects') {
    if (!/^\d+$/.test(parts[3])) {
      return { ok: false, reason: 'Project number must be numeric' };
    }
    return { ok: true, value: trimmed };
  }

  return {
    ok: false,
    reason: 'URL must point to a GitHub Project (e.g. https://github.com/orgs/acme/projects/3)',
  };
}

export function deriveGithubIssueUrl(
  remote: string | null | undefined,
  issueNumber: number,
): string | null {
  const base = githubRepoUrl(remote);
  return base ? `${base}/issues/${issueNumber}` : null;
}

/**
 * GitHub compare URL: `https://github.com/<owner>/<repo>/compare/<base>...<branch>`
 *
 * Returns `null` when any input is missing or the remote is not parseable.
 */
export function githubCompareUrl(
  remote: string | null | undefined,
  base: string | null | undefined,
  branch: string | null | undefined,
): string | null {
  if (!base || !branch) return null;
  const repoBase = githubRepoUrl(remote);
  return repoBase
    ? `${repoBase}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`
    : null;
}

export interface ParsedGithubProject {
  /** Whether the project lives under an organization or a user. */
  ownerType: 'orgs' | 'users';
  /** Organization login or user login, preserved in its original case. */
  owner: string;
  /** The numeric project number (e.g., 3 from `/projects/3`). */
  number: number;
}

/**
 * Parse a Projects v2 URL into its components so callers can feed
 * `gh project item-add <number> --owner <owner>`. Returns `null` for any
 * value that cannot be used with the item-add command, specifically:
 *
 *   - null, empty, or whitespace-only strings
 *   - the legacy repo-scoped form (`<owner>/<repo>/projects/<n>`), which
 *     points at the repo's "linked Projects" tab — not a Projects v2 board
 *   - malformed URLs, non-https, or non-github.com hosts
 *   - non-numeric project numbers
 *   - URLs missing the `/projects/<n>` trailing segments
 *
 * Owner case is preserved (GitHub logins are case-insensitive, and `gh`
 * handles any needed normalization on its own).
 *
 * `validateGithubProjectUrl` already gates save-time input for this
 * field; the parser is the read-time counterpart that turns a stored
 * string into something the CLI can use.
 */
export function parseGithubProjectUrl(raw: string | null | undefined): ParsedGithubProject | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const u = parseGithubHttpsUrl(trimmed);
  if (!u) return null;

  const parts = githubPathParts(u);
  // orgs/<org>/projects/<n>  or  users/<user>/projects/<n>
  if (
    parts.length >= 4 &&
    (parts[0] === 'orgs' || parts[0] === 'users') &&
    parts[2] === 'projects' &&
    /^\d+$/.test(parts[3])
  ) {
    return {
      ownerType: parts[0] as 'orgs' | 'users',
      owner: parts[1],
      number: Number.parseInt(parts[3], 10),
    };
  }
  // Legacy repo-scoped form: `<owner>/<repo>/projects/<n>` — cannot be
  // passed to `gh project item-add`, so treat as unparseable here even
  // though `validateGithubProjectUrl` accepts it for the quick-link button.
  return null;
}
