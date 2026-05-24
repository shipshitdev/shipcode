import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
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

const SAFE_BASENAME = /^[A-Za-z0-9._-]+$/;

/**
 * Defense-in-depth check before spawning an agent CLI in a workspace.
 *
 * Three invariants:
 *   1. `workspacePath` must be absolute and free of traversal segments
 *      (i.e. `path.resolve` returns it unchanged).
 *   2. `path.basename(workspacePath)` must match `[A-Za-z0-9._-]+`.
 *      Rejects shell-metacharacter directory names that survived earlier
 *      sanitization (spaces, `$`, backticks, semicolons, etc.).
 *   3. When `workspaceRoot` is set (i.e. not the `project-local` sentinel),
 *      `workspacePath` must live under the expanded root. Skipped for
 *      project-local mode (`worktreeRoot === ''`) since the worktree is
 *      under the project itself.
 *
 * Throws on violation. Callers should treat any throw as fatal — a
 * mismatch here means the pipeline is about to spawn an agent in the
 * wrong directory.
 */
export function assertWorkspaceSafe(opts: {
  workspacePath: string;
  workspaceRoot: string | null | undefined;
}): void {
  const { workspacePath, workspaceRoot } = opts;

  if (!path.isAbsolute(workspacePath)) {
    throw new Error(`workspacePath must be absolute (got: ${workspacePath})`);
  }
  const resolved = path.resolve(workspacePath);
  if (resolved !== workspacePath) {
    throw new Error(
      `workspacePath contains traversal or non-canonical segments (got: ${workspacePath}, resolved: ${resolved})`,
    );
  }

  const base = path.basename(resolved);
  if (!SAFE_BASENAME.test(base)) {
    throw new Error(`workspacePath basename must match [A-Za-z0-9._-]+ (got: ${base})`);
  }

  const expanded = expandWorktreeRoot(workspaceRoot);
  if (expanded === 'project-local') return;

  const rootResolved = path.resolve(expanded);
  const rel = path.relative(rootResolved, resolved);
  const escapes = rel.startsWith('..') || path.isAbsolute(rel);
  if (escapes) {
    throw new Error(
      `workspacePath must live under workspaceRoot (root: ${rootResolved}, path: ${resolved})`,
    );
  }
}
