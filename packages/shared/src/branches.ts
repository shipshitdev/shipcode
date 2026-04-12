/**
 * Branch list normalization for the per-project base branch selector.
 *
 * Takes raw output from `simple-git.branch(['-a']).all` and returns a sorted,
 * deduped list of refs that can be passed directly to `git worktree add`.
 *
 * Rules:
 *   - Local branches keep their plain name (e.g. "main", "feat/x").
 *   - Remote-only branches keep their "<remote>/<branch>" prefix so they
 *     resolve as distinct refs on multi-remote repos.
 *   - When both local "foo" and "origin/foo" exist, the local wins (dedupe).
 *   - Internal `shipcode/*` branches are filtered out (they're worktree
 *     implementation branches, not user-pickable bases).
 *   - HEAD pointer entries ("HEAD -> origin/main") and detached HEAD markers
 *     ("(HEAD detached at sha)", "(no branch, ...)") are filtered.
 *   - Sort: project default first (whether local or remote-only), then
 *     common defaults (main/master/develop/trunk) if present, then rest
 *     alphabetically with locals before remote-only.
 */
export interface NormalizeBranchesInput {
  /** BranchSummary.all from simple-git */
  raw: string[];
  /** The project's currently persisted default branch (pinned first if present) */
  defaultBranch: string;
}

const COMMON_DEFAULTS = ['main', 'master', 'develop', 'trunk'];
const SHIPCODE_BRANCH_RE = /^(shipcode\/|feat\/\d+-)/;

export function normalizeBranches({ raw, defaultBranch }: NormalizeBranchesInput): string[] {
  const locals = new Set<string>();
  const remoteOnly = new Set<string>(); // resolvable ref, e.g. "origin/foo"

  for (const name of raw) {
    if (!name) continue;
    if (name.includes('->')) continue; // HEAD pointer line
    if (name.startsWith('(HEAD detached')) continue; // detached HEAD marker
    if (name.startsWith('(no branch')) continue; // alternate detached marker

    if (name.startsWith('remotes/')) {
      // remotes/<remote>/<branch...> → "<remote>/<branch...>"
      const stripped = name.replace(/^remotes\//, '');
      const firstSlash = stripped.indexOf('/');
      if (firstSlash < 0) continue;
      const branchPart = stripped.slice(firstSlash + 1);
      if (SHIPCODE_BRANCH_RE.test(branchPart)) continue;
      if (branchPart === 'HEAD') continue;
      remoteOnly.add(stripped);
    } else {
      if (SHIPCODE_BRANCH_RE.test(name)) continue;
      locals.add(name);
    }
  }

  // Dedupe: if local "foo" exists, drop any "*/foo" remote-only entry.
  for (const display of [...remoteOnly]) {
    const branchPart = display.slice(display.indexOf('/') + 1);
    if (locals.has(branchPart)) remoteOnly.delete(display);
  }

  // Sort with pinning. defaultBranch may be a plain local ("main") OR a
  // remote-only ref ("origin/trunk") — both are valid persisted values.
  const pinned: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    pinned.push(name);
  };

  if (locals.has(defaultBranch) || remoteOnly.has(defaultBranch)) {
    push(defaultBranch);
  }
  for (const common of COMMON_DEFAULTS) {
    if (locals.has(common)) push(common);
  }

  const localRest = [...locals].filter((n) => !seen.has(n)).sort((a, b) => a.localeCompare(b));
  const remoteRest = [...remoteOnly].filter((n) => !seen.has(n)).sort((a, b) => a.localeCompare(b));

  return [...pinned, ...localRest, ...remoteRest];
}
