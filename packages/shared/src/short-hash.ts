/**
 * Truncate a commit SHA for display. Returns '' for a missing SHA so callers
 * can pick their own placeholder (`shortHash(sha, 7) || 'unknown'`).
 *
 * Default length 12 matches the checkpoint UI, which is the majority of call
 * sites; the git-visualizer worktree list passes 7.
 */
export function shortHash(sha: string | null | undefined, length = 12): string {
  if (!sha) return '';
  return sha.slice(0, length);
}
