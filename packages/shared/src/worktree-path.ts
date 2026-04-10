import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DEFAULT_WORKTREE_ROOT, WORKTREE_DIR } from './constants';

/**
 * Expand a user-facing worktreeRoot setting into either an absolute directory
 * or the sentinel 'project-local' (meaning: use <project>/.shipcode/worktrees).
 *
 * Accepted inputs:
 *   null                 → DEFAULT_WORKTREE_ROOT (~/.shipcode/worktrees)
 *   ''                   → 'project-local'
 *   '~' | '~/…'          → os.homedir() joined with the remainder
 *   absolute path        → path.resolve(value)
 *   anything else        → throws (rejects '~user/…' and relative paths)
 */
export function expandWorktreeRoot(raw: string | null | undefined): string | 'project-local' {
  const value = (raw ?? DEFAULT_WORKTREE_ROOT).trim();
  if (value === '') return 'project-local';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (value.startsWith('~')) {
    throw new Error('~user paths are not supported; use ~/ or an absolute path');
  }
  if (path.isAbsolute(value)) return path.resolve(value);
  throw new Error(`worktreeRoot must be absolute or ~-prefixed (got: ${value})`);
}

/**
 * Deterministic per-project directory name for the global-root layout.
 * Combines a sanitized basename with a short hash of the absolute path so
 * two projects with the same basename don't collide.
 */
export function projectSlug(projectPath: string): string {
  const base = path
    .basename(projectPath)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 48);
  const hash = createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 6);
  return `${base}-${hash}`;
}

/**
 * Resolve the parent directory that holds all worktrees for a given project.
 * Each worktree is then a child directory named after its threadId.
 */
export function resolveWorktreeParent(
  projectPath: string,
  worktreeRoot: string | null | undefined,
): string {
  const expanded = expandWorktreeRoot(worktreeRoot);
  if (expanded === 'project-local') {
    return path.join(projectPath, WORKTREE_DIR);
  }
  return path.join(expanded, projectSlug(projectPath));
}
