/**
 * Path confinement for file tools.
 *
 * Every filesystem-touching tool calls `assertPathInWorktree` BEFORE
 * the read/write operation and AGAIN when resolving the real path.
 *
 * Threat model this defends against:
 *
 * 1. Absolute paths outside the worktree (`/etc/passwd`).
 * 2. Relative path escapes (`../../root/.ssh/id_rsa`).
 * 3. Symlinks that point outside the worktree. The guard resolves the
 *    real path via `fs.realpath` at the time of the operation, not at
 *    tool registration, which defeats TOCTOU races where an attacker
 *    (or the model itself) creates a symlink inside the worktree
 *    between tool invocations.
 * 4. Paths that do not exist yet (for Write tool) — we validate the
 *    parent directory's realpath instead of the file itself, so
 *    creation is still allowed but only within the worktree subtree.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathGuardError';
  }
}

/**
 * Resolve `targetPath` against `worktreePath`, then assert the resolved
 * real path is inside the worktree. Throws PathGuardError if not.
 *
 * Returns the resolved absolute path (suitable for passing to fs.*).
 *
 * @param targetPath - The path the tool wants to touch. May be
 *   absolute or relative. Relative paths are resolved against the
 *   worktree root (not process.cwd).
 * @param worktreePath - The worktree root. Must itself be an absolute path.
 * @param options.mustExist - If true, the target path must already exist.
 *   If false (default), the parent directory must exist and be inside
 *   the worktree, but the target itself may be created.
 */
export async function assertPathInWorktree(
  targetPath: string,
  worktreePath: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  if (!path.isAbsolute(worktreePath)) {
    throw new PathGuardError(`worktreePath must be absolute; got ${worktreePath}`);
  }

  // Resolve the worktree's real path once — if the worktree itself
  // is a symlink, we use its target as the confinement boundary.
  let worktreeRealPath: string;
  try {
    worktreeRealPath = await fs.realpath(worktreePath);
  } catch (err) {
    throw new PathGuardError(
      `worktree path does not exist: ${worktreePath} (${(err as Error).message})`,
    );
  }

  // Resolve the candidate path against the worktree. Absolute targets
  // stay absolute; relative targets are rooted at the worktree.
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(worktreeRealPath, targetPath);

  const { mustExist = false } = options;

  if (mustExist) {
    // Target must exist. Resolve its real path directly and check that
    // it's under the worktree's real path. This covers symlink targets
    // that point outside the worktree.
    let realPath: string;
    try {
      realPath = await fs.realpath(resolved);
    } catch (err) {
      throw new PathGuardError(
        `path does not exist or is unreachable: ${targetPath} (${(err as Error).message})`,
      );
    }
    assertUnder(realPath, worktreeRealPath, targetPath);
    return realPath;
  }

  // Target may not exist yet (e.g. Write tool creating a new file).
  // Walk up parents until we find one that does, then realpath-check
  // that — this still prevents creating files outside the worktree
  // via symlinked parents.
  let probe = resolved;
  while (true) {
    try {
      const parentReal = await fs.realpath(probe);
      // The probe directory exists; require it is inside the worktree.
      assertUnder(parentReal, worktreeRealPath, targetPath);
      // The target itself is the resolved path relative to the same
      // realpath rewrite that the existing ancestor underwent.
      const tail = path.relative(probe, resolved);
      return tail === '' ? parentReal : path.join(parentReal, tail);
    } catch (err) {
      if (err instanceof PathGuardError) throw err;
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new PathGuardError(`no existing ancestor directory found for ${targetPath}`);
      }
      probe = parent;
    }
  }
}

function assertUnder(candidate: string, boundary: string, originalInput: string): void {
  // Normalize with trailing separator so '/foo' is not accepted as under '/foobar'.
  const normBoundary = boundary.endsWith(path.sep) ? boundary : boundary + path.sep;
  const normCandidate = candidate.endsWith(path.sep) ? candidate : candidate + path.sep;
  if (!normCandidate.startsWith(normBoundary) && candidate !== boundary) {
    throw new PathGuardError(
      `path escapes worktree: ${originalInput} (resolved to ${candidate}, worktree ${boundary})`,
    );
  }
}
