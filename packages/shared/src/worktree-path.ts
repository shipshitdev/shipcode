import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_WORKTREE_ROOT } from './constants';

/**
 * Expand a leading `~` against the current user's home directory.
 *
 * Returns `null` for anything that is not tilde-prefixed, so callers keep
 * control of the non-tilde branches (absolute vs relative vs fallback), which
 * differ between the worktree-root setting and the Add Project browser.
 * `~user/…` is deliberately not supported and yields `null` too.
 */
export function expandTilde(value: string): string | null {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return null;
}

/**
 * Expand a user-facing worktreeRoot setting into an absolute directory.
 *
 * Accepted inputs:
 *   null | undefined     → DEFAULT_WORKTREE_ROOT (~/.shipcode/worktrees)
 *   '' (or whitespace)   → DEFAULT_WORKTREE_ROOT — see note below
 *   '~' | '~/…'          → os.homedir() joined with the remainder
 *   absolute path        → path.resolve(value)
 *   anything else        → throws (rejects '~user/…' and relative paths)
 *
 * Empty string used to select a `project-local` mode (worktrees under
 * <project>/.shipcode/worktrees). That mode is retired: the settings store
 * serializes `null` to `''` for every key, so `''` at rest is indistinguishable
 * from "unset" and no UI ever offered the choice. It is accepted here — rather
 * than rejected — so any `''` left in an existing database, IPC payload, or
 * options bag resolves to the default root instead of throwing at worktree
 * creation time.
 */
export function expandWorktreeRoot(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  const value = trimmed === '' ? DEFAULT_WORKTREE_ROOT : trimmed;
  const expanded = expandTilde(value);
  if (expanded !== null) return expanded;
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
  return path.join(expandWorktreeRoot(worktreeRoot), projectSlug(projectPath));
}

const SAFE_BASENAME = /^[A-Za-z0-9._-]+$/;

const OS_PATH_ALIAS_ROOTS = new Set(['/tmp', '/var', '/private/tmp', '/private/var']);

/**
 * macOS (and some Linux setups) expose lexical roots that are always symlinks:
 * `/tmp`→`/private/tmp` and `/var`→`/private/var`. They ship with the OS and are
 * not user-plantable, so walking through them is safe — unlike any other symlink
 * on a workspace path, which a caller (or an attacker) could have created.
 */
export function isOsPathAliasRoot(candidate: string): boolean {
  return OS_PATH_ALIAS_ROOTS.has(path.resolve(candidate));
}

/**
 * Canonical form of `input` for equality comparisons: realpath-resolved as far
 * as the path exists, with any missing tail re-appended verbatim. Two spellings
 * of the same location (`/var/folders/…` and `/private/var/folders/…`) compare
 * equal, so a caller's lexical path matches what Git persisted.
 *
 * Never throws for a missing path: `git worktree list` legitimately reports
 * registrations whose directory has already been deleted.
 */
export function canonicalizeWorktreePath(input: string): string {
  const resolved = path.resolve(input);
  const missing: string[] = [];
  let current = resolved;

  while (true) {
    try {
      const real = realpathSync.native(current);
      return missing.length > 0 ? path.join(real, ...missing) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Walk up past segments that do not exist (or that sit under a file);
      // anything else means we cannot canonicalize, so fail closed.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    missing.unshift(path.basename(current));
    current = parent;
  }
}

/**
 * Reject every user-plantable symlink on `target`'s lexical path, including the
 * final segment, allowing only OS alias roots. This is the check that stops a
 * crafted link from redirecting a workspace outside its configured root — path
 * *equality* is a separate concern handled by `canonicalizeWorktreePath`, which
 * is why comparing realpaths is not a substitute for this walk.
 */
export function assertNoUnsafeSymlinkAncestors(target: string, label: string): void {
  let ancestor = path.resolve(target);

  while (true) {
    let link = false;
    try {
      link = lstatSync(ancestor).isSymbolicLink();
    } catch (error) {
      // Missing ancestors are fine (callers may validate a path before it is
      // created); anything else means we cannot prove containment, so fail closed.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (link && !isOsPathAliasRoot(ancestor)) {
      throw new Error(`${label} must not resolve through symlinks (symlink: ${ancestor})`);
    }
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
}

/**
 * Defense-in-depth check before spawning an agent CLI in a workspace.
 *
 * Invariants:
 *   1. `workspacePath` must be absolute and free of traversal segments
 *      (i.e. `path.resolve` returns it unchanged).
 *   2. `path.basename(workspacePath)` must match `[A-Za-z0-9._-]+`.
 *      Rejects shell-metacharacter directory names that survived earlier
 *      sanitization (spaces, `$`, backticks, semicolons, etc.).
 *   3. Without a project identity, `workspacePath` must live under the expanded
 *      root. `workspaceRoot` of `null`/`''` expands to the default root, so
 *      containment is always enforced on this branch.
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

  const boundary = projectPath ? null : expandWorktreeRoot(workspaceRoot);

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
  // Reject crafted links segment by segment rather than by comparing the whole
  // path to its realpath: OS alias roots make realpath differ for every path
  // under `/var` or `/tmp`, which is legitimate.
  assertNoUnsafeSymlinkAncestors(workspacePath, 'workspacePath');

  const projectLayout = resolveGitLayout(projectPath);
  const workspaceLayout = resolveGitLayout(workspacePath);
  if (projectLayout.commonDir !== workspaceLayout.commonDir) {
    throw new Error(
      `workspacePath belongs to a foreign Git repository (project: ${projectLayout.commonDir}, workspace: ${workspaceLayout.commonDir})`,
    );
  }

  if (workspaceLayout.gitDir === workspaceLayout.commonDir) {
    throw new Error(
      `workspacePath is the main repository, not a linked worktree: ${workspacePath}`,
    );
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

  // Git persists the canonical path, so compare canonical-to-canonical: the
  // caller may legitimately spell the same location through an OS alias root.
  const registeredPath = canonicalizeWorktreePath(path.dirname(registeredDotGit));
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
