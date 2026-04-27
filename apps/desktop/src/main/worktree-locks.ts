/**
 * In-memory per-worktree mutex. Auto-commit and cleanup acquire this lock to
 * prevent concurrent destructive git operations on the same worktree path.
 * Lives only for the lifetime of the main process — never persisted.
 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Run `fn` while holding the lock for `worktreePath`. Throws immediately if
 * the lock is already held.
 */
export async function withWorktreeLock<T>(worktreePath: string, fn: () => Promise<T>): Promise<T> {
  if (inflight.has(worktreePath)) {
    throw new Error(`worktree busy: ${worktreePath}`);
  }
  const promise = (async () => fn())();
  inflight.set(worktreePath, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(worktreePath);
  }
}

export function isWorktreeLocked(worktreePath: string): boolean {
  return inflight.has(worktreePath);
}
