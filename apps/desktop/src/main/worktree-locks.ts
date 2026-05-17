/**
 * In-memory per-worktree mutex. Auto-commit and cleanup acquire this lock to
 * prevent concurrent destructive git operations on the same worktree path.
 * Lives only for the lifetime of the main process — never persisted.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

const inflight = new Map<string, Promise<unknown>>();

function lockKey(worktreePath: string): string {
  const resolved = path.resolve(worktreePath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Run `fn` while holding the lock for `worktreePath`. Throws immediately if
 * the lock is already held.
 */
export async function withWorktreeLock<T>(worktreePath: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(worktreePath);
  if (inflight.has(key)) {
    throw new Error(`worktree busy: ${worktreePath}`);
  }
  const promise = (async () => fn())();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function isWorktreeLocked(worktreePath: string): boolean {
  return inflight.has(lockKey(worktreePath));
}
