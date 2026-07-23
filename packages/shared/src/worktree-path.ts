import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
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
 * Invariants:
 *   1. `workspacePath` must be absolute and free of traversal segments
 *      (i.e. `path.resolve` returns it unchanged).
 *   2. `path.basename(workspacePath)` must match `[A-Za-z0-9._-]+`.
 *      Rejects shell-metacharacter directory names that survived earlier
 *      sanitization (spaces, `$`, backticks, semicolons, etc.).
 *   3. Without a project identity, when `workspaceRoot` is set (i.e. not the
 *      `project-local` sentinel),
 *      `workspacePath` must live under the expanded root. Skipped for
 *      project-local mode (`worktreeRoot === ''`) since the worktree is
 *      under the project itself.
 *   4. With `projectPath`, the existing workspace must resolve to a linked
 *      worktree registered to that exact Git repository at that exact path.
 *      This intentionally supersedes root containment because the configured
 *      root may change after the concrete worktree path was persisted.
 *
 * Throws on violation. Callers should treat any throw as fatal — a
 * mismatch here means the pipeline is about to spawn an agent in the
 * wrong directory.
 */
export function assertWorkspaceSafe(opts: {
  workspacePath: string;
  workspaceRoot: string | null | undefined;
  /** Raw repository root used to bind this workspace to one exact project. */
  projectPath?: string;
}): void {
  const { workspacePath, workspaceRoot, projectPath } = opts;

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
  const boundary = projectPath || expanded === 'project-local' ? null : expanded;

  if (boundary && !isPathInside(boundary, resolved)) {
    throw new Error(
      `workspacePath must live under workspaceRoot (root: ${path.resolve(boundary)}, path: ${resolved})`,
    );
  }

  // Existing worktrees are authorized by persisted Git registration, never by
  // re-deriving their parent from mutable settings. Project-aware checks bind
  // the real path to the exact repository and linked-worktree registration.
  if (!projectPath) return;
  resolveRealPath(resolved, 'workspacePath');
  assertGitWorkspaceIdentity(projectPath, resolved);
}

/** Reject an existing workspace whose Git common directory differs from the project. */
export function assertGitWorkspaceIdentity(projectPath: string, workspacePath: string): void {
  const projectLayout = resolveGitLayout(projectPath);
  const workspaceLayout = resolveGitLayout(workspacePath);
  if (workspaceLayout.workspaceReal !== path.resolve(workspacePath)) {
    throw new Error(
      `workspacePath must not resolve through symlinks (path: ${path.resolve(workspacePath)}, real: ${workspaceLayout.workspaceReal})`,
    );
  }
  if (projectLayout.commonDir !== workspaceLayout.commonDir) {
    throw new Error(
      `workspacePath belongs to a foreign Git repository (project: ${projectLayout.commonDir}, workspace: ${workspaceLayout.commonDir})`,
    );
  }

  if (workspaceLayout.gitDir === workspaceLayout.commonDir) {
    throw new Error(`workspacePath is the main repository, not a linked worktree: ${workspacePath}`);
  }

  const expectedAdminParent = path.join(projectLayout.commonDir, 'worktrees');
  if (path.dirname(workspaceLayout.gitDir) !== expectedAdminParent) {
    throw new Error(
      `workspacePath Git admin directory is not registered under the project (admin: ${workspaceLayout.gitDir}, expected parent: ${expectedAdminParent})`,
    );
  }

  let registeredDotGit: string;
  try {
    const pointer = readFileSync(path.join(workspaceLayout.gitDir, 'gitdir'), 'utf8').trim();
    if (!pointer) throw new Error('empty gitdir pointer');
    registeredDotGit = path.resolve(workspaceLayout.gitDir, pointer);
  } catch (error) {
    throw new Error(
      `workspacePath is missing linked-worktree registration (${workspacePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const registeredPathInput = path.resolve(path.dirname(registeredDotGit));
  if (registeredPathInput !== path.resolve(workspacePath)) {
    throw new Error(
      `workspacePath does not match its Git-registered path (registered: ${registeredPathInput}, path: ${path.resolve(workspacePath)})`,
    );
  }
  const registeredPath = resolveRealPath(registeredPathInput, 'registered worktree path');
  if (registeredPath !== workspaceLayout.workspaceReal) {
    throw new Error(
      `workspacePath does not match its Git-registered path (registered: ${registeredPath}, path: ${workspaceLayout.workspaceReal})`,
    );
  }

  const head = readFileSync(path.join(workspaceLayout.gitDir, 'HEAD'), 'utf8').trim();
  if (!head.startsWith('ref: refs/heads/')) {
    throw new Error(`workspacePath must be attached to a branch: ${workspacePath}`);
  }
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRealPath(input: string, label: string): string {
  try {
    return realpathSync.native(path.resolve(input));
  } catch (error) {
    throw new Error(
      `${label} must exist and be reachable (${input}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveGitLayout(workspacePath: string): {
  workspaceReal: string;
  gitDir: string;
  commonDir: string;
} {
  const workspaceReal = resolveRealPath(workspacePath, 'Git workspace');
  const dotGit = path.join(workspaceReal, '.git');
  let gitDir: string;

  try {
    const stat = lstatSync(dotGit);
    if (stat.isDirectory()) {
      gitDir = realpathSync.native(dotGit);
    } else if (stat.isFile()) {
      const match = /^gitdir:\s*(.+)\s*$/i.exec(readFileSync(dotGit, 'utf8'));
      if (!match?.[1]) throw new Error('invalid .git file');
      gitDir = resolveRealPath(path.resolve(workspaceReal, match[1]), 'Git directory');
    } else {
      throw new Error('.git is neither a file nor a directory');
    }
  } catch (error) {
    throw new Error(
      `workspacePath is not a valid Git workspace (${workspacePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const commonDir = readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
    if (!commonDir) throw new Error('empty commondir');
    return {
      workspaceReal,
      gitDir,
      commonDir: resolveRealPath(path.resolve(gitDir, commonDir), 'Git common directory'),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { workspaceReal, gitDir, commonDir: gitDir };
    throw error;
  }
}
