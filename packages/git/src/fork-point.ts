import { runGit } from './git-exec';

/**
 * Ref ladder for a base branch: the name as given, then its remote-tracking
 * form.
 *
 * A repository that was cloned and then only ever worked through ShipCode
 * worktrees has no local ref for its trunk — `git rev-parse master` fails even
 * though `origin/master` is sitting right there, because rev-parse's
 * disambiguation rules never reach `refs/remotes/origin/<name>`. Callers that
 * probed the bare name silently recorded an empty fork point for those repos.
 *
 * A base that is already remote-qualified is used as-is, mirroring
 * `resolveForkBase` in WorktreeManager and the base-candidate ladder in the
 * pipeline's diff-base resolver so every path agrees on what "the base branch"
 * resolves to.
 */
function forkPointCandidateRefs(baseBranch: string): string[] {
  const base = baseBranch.trim();
  if (!base) return [];
  return Array.from(new Set([base, base.startsWith('origin/') ? base : `origin/${base}`]));
}

/**
 * Resolve the commit a run forks from, tolerating a trunk that exists only as a
 * remote-tracking ref.
 *
 * Returns `''` when neither form resolves — the same "unknown base" value
 * callers already persist — so a missing base degrades exactly as before rather
 * than failing the run. Callers should debug-log that case; the empty string is
 * otherwise indistinguishable from a repo with no base at all.
 */
export async function resolveForkPointSha(cwd: string, baseBranch: string): Promise<string> {
  for (const ref of forkPointCandidateRefs(baseBranch)) {
    try {
      return await runGit(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
    } catch {
      // Expected for the bare name in a worktree-only clone; try the next ref.
    }
  }
  return '';
}
