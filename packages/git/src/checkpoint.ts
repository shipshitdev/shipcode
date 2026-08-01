import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
// Checkpoint capture stages into an isolated temporary index (GIT_INDEX_FILE)
// and restore is not on the per-node execute path, so these calls never contend
// for the real index and take the shared transport's unlocked variant.
import { runGitUnlocked as runGit } from './git-exec';

/**
 * ShipCode-owned hidden checkpoint refs (issue #212).
 *
 * Layout: refs/shipcode/checkpoints/<threadId>/turn/<n>
 *
 * Each ref points at a commit whose tree snapshots the FULL worktree
 * filesystem state at capture time — tracked modifications, deletions, and
 * untracked (non-ignored) files — with the worktree's HEAD as parent. Capture
 * stages into an isolated temporary index (GIT_INDEX_FILE) so the real index,
 * branches, tags, and stash are never touched. Refs are local-only and must
 * never be pushed.
 */
export const CHECKPOINT_REF_ROOT = 'refs/shipcode/checkpoints';

const CHECKPOINT_IDENTITY_NAME = 'ShipCode';
const CHECKPOINT_IDENTITY_EMAIL = 'shipcode@users.noreply.github.com';

export interface CheckpointRef {
  refName: string;
  turn: number;
  /** SHA of the checkpoint commit the ref points at (not the worktree HEAD). */
  commitSha: string;
  /**
   * Worktree HEAD commit the checkpoint parents onto (the base for restore/
   * resume diffs), or `null` on an unborn HEAD. This is the sha callers should
   * persist as the checkpoint's `commitSha` DB column — reuse it instead of a
   * second `rev-parse HEAD` subprocess.
   */
  headSha: string | null;
  /** Abbreviated current branch (`HEAD` when detached), or `null` if unresolved. */
  branch: string | null;
}

/**
 * Async worktree HEAD commit resolver (peeled to a commit), `null` on failure
 * or an unborn HEAD. Shared by capture and by callers that need the base sha
 * when a full capture failed — never use synchronous git on hot pipeline paths.
 */
export async function resolveHeadCommit(cwd: string): Promise<string | null> {
  try {
    return await runGit(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
  } catch {
    return null;
  }
}

/** Async current-branch resolver (`HEAD` when detached), `null` on failure. */
export async function resolveCurrentBranch(cwd: string): Promise<string | null> {
  try {
    return await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return null;
  }
}

/**
 * Thread ids are nanoid-shaped, but sanitize defensively so any input yields a
 * valid git refname component (no dots avoids the `..`/`.lock` refname rules).
 */
function sanitizeRefComponent(threadId: string): string {
  return threadId.replace(/[^A-Za-z0-9_-]/g, '-');
}

export function checkpointRefPrefix(threadId: string): string {
  return `${CHECKPOINT_REF_ROOT}/${sanitizeRefComponent(threadId)}`;
}

export function checkpointRefName(threadId: string, turn: number): string {
  return `${checkpointRefPrefix(threadId)}/turn/${turn}`;
}

/** Extract the turn number from a checkpoint ref name; null if not one. */
export function parseCheckpointTurn(refName: string): number | null {
  const match = /\/turn\/(\d+)$/.exec(refName);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** List a thread's checkpoint refs, sorted by turn ascending. */
export async function listCheckpointRefs(
  repoPath: string,
  threadId: string,
): Promise<CheckpointRef[]> {
  const output = await runGit(repoPath, [
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    `${checkpointRefPrefix(threadId)}/`,
  ]);
  if (!output) return [];
  const refs: CheckpointRef[] = [];
  for (const line of output.split('\n')) {
    const [refName, commitSha] = line.trim().split(' ');
    const turn = refName ? parseCheckpointTurn(refName) : null;
    if (refName && commitSha && turn !== null) {
      // headSha/branch are capture-time worktree metadata not recoverable from
      // a read-back ref; list consumers only use refName/turn.
      refs.push({ refName, turn, commitSha, headSha: null, branch: null });
    }
  }
  return refs.sort((a, b) => a.turn - b.turn);
}

export interface CaptureCheckpointOptions {
  /**
   * Highest turn already recorded for this thread in the caller's durable store
   * (the SQLite checkpoint rows). When provided, the next turn is derived as
   * `lastKnownTurn + 1` and the live `for-each-ref` scan is skipped entirely
   * (#328): the DB is the monotonic high-water mark, so a turn is never reused
   * even after older refs were pruned on rollback. Pass `null`/omit for legacy
   * threads with no DB turn — capture then falls back to scanning live refs.
   */
  lastKnownTurn?: number | null;
}

/**
 * Snapshot the worktree's current filesystem state into a hidden checkpoint
 * ref. Uses a temporary index under the repo's common git dir so the real
 * index is never mutated; the checkpoint commit parents onto the worktree's
 * HEAD so restores know their base.
 */
export async function captureCheckpoint(
  worktreePath: string,
  threadId: string,
  options: CaptureCheckpointOptions = {},
): Promise<CheckpointRef> {
  const commonDirRaw = await runGit(worktreePath, ['rev-parse', '--git-common-dir']);
  const commonDir = path.resolve(worktreePath, commonDirRaw);
  const tempIndex = path.join(
    commonDir,
    `shipcode-checkpoint-${randomBytes(6).toString('hex')}.index`,
  );
  const indexEnv = { GIT_INDEX_FILE: tempIndex };

  // Unborn HEAD → null: capture still works, but the checkpoint has no parent.
  const headSha = await resolveHeadCommit(worktreePath);
  const branch = await resolveCurrentBranch(worktreePath);

  try {
    if (headSha) {
      await runGit(worktreePath, ['read-tree', 'HEAD'], indexEnv);
    } else {
      await runGit(worktreePath, ['read-tree', '--empty'], indexEnv);
    }
    await runGit(worktreePath, ['add', '-A', '--', '.'], indexEnv);
    const treeSha = await runGit(worktreePath, ['write-tree'], indexEnv);

    // Prefer the caller's durable high-water mark (DB rows) so a turn is never
    // reused after older refs were pruned, and skip the O(refs) for-each-ref
    // scan the caller already paid for via getLatest (#328). Fall back to the
    // live-ref scan only for legacy threads with no known DB turn.
    let turn: number;
    if (typeof options.lastKnownTurn === 'number' && Number.isFinite(options.lastKnownTurn)) {
      turn = options.lastKnownTurn + 1;
    } else {
      const existing = await listCheckpointRefs(worktreePath, threadId);
      turn = existing.length > 0 ? existing[existing.length - 1].turn + 1 : 0;
    }
    const refName = checkpointRefName(threadId, turn);

    const commitSha = await runGit(
      worktreePath,
      [
        'commit-tree',
        treeSha,
        ...(headSha ? ['-p', headSha] : []),
        '-m',
        `[shipcode] checkpoint ${threadId} turn ${turn}`,
      ],
      {
        GIT_AUTHOR_NAME: CHECKPOINT_IDENTITY_NAME,
        GIT_AUTHOR_EMAIL: CHECKPOINT_IDENTITY_EMAIL,
        GIT_COMMITTER_NAME: CHECKPOINT_IDENTITY_NAME,
        GIT_COMMITTER_EMAIL: CHECKPOINT_IDENTITY_EMAIL,
      },
    );
    await runGit(worktreePath, ['update-ref', refName, commitSha]);
    return { refName, turn, commitSha, headSha, branch };
  } finally {
    rmSync(tempIndex, { force: true });
  }
}

/**
 * Restore the worktree to a checkpoint's captured filesystem state:
 * HEAD moves back to the checkpoint's base commit, files created after the
 * checkpoint are removed, and the captured dirty state (modified/deleted/
 * untracked files) is reproduced as uncommitted changes.
 */
export async function restoreCheckpoint(worktreePath: string, refName: string): Promise<void> {
  await runGit(worktreePath, ['rev-parse', '--verify', `${refName}^{commit}`]);

  let baseSha: string;
  try {
    baseSha = await runGit(worktreePath, ['rev-parse', '--verify', `${refName}^^{commit}`]);
  } catch {
    throw new Error(`Checkpoint ${refName} has no parent commit; cannot restore`);
  }

  await runGit(worktreePath, ['reset', '--hard', baseSha]);
  await runGit(worktreePath, ['clean', '-fd']);

  const treeEntries = await runGit(worktreePath, ['ls-tree', '-r', '--name-only', refName]);
  if (treeEntries) {
    await runGit(worktreePath, [
      'restore',
      '--source',
      refName,
      '--worktree',
      '--staged',
      '--',
      '.',
    ]);
    // Unstage: index back to HEAD, worktree keeps the restored files so the
    // captured dirty state shows up as modified/deleted/untracked again.
    await runGit(worktreePath, ['reset', '--quiet']);
  }
}

/**
 * Delete a thread's checkpoint refs, optionally filtered by turn:
 * `newerThanTurn` keeps turns ≤ N (post-rollback pruning), `olderThanTurn`
 * keeps turns ≥ N (capture-time GC that retains only the most recent turns,
 * #328). With neither, every ref for the thread is deleted. Best-effort:
 * individual delete failures are skipped. Returns the number deleted.
 */
export async function deleteThreadCheckpointRefs(
  repoPath: string,
  threadId: string,
  options: { newerThanTurn?: number; olderThanTurn?: number } = {},
): Promise<number> {
  const refs = await listCheckpointRefs(repoPath, threadId);
  const { newerThanTurn, olderThanTurn } = options;
  const targets = refs.filter(
    (ref) =>
      (newerThanTurn === undefined || ref.turn > newerThanTurn) &&
      (olderThanTurn === undefined || ref.turn < olderThanTurn),
  );
  let deleted = 0;
  for (const ref of targets) {
    try {
      await runGit(repoPath, ['update-ref', '-d', ref.refName]);
      deleted++;
    } catch {
      // Best-effort cleanup — a stale ref must never block teardown.
    }
  }
  return deleted;
}

/**
 * Delete every ShipCode checkpoint ref in the repository (project remove/
 * archive teardown). Best-effort; returns the number deleted.
 */
export async function deleteAllCheckpointRefs(repoPath: string): Promise<number> {
  const output = await runGit(repoPath, [
    'for-each-ref',
    '--format=%(refname)',
    `${CHECKPOINT_REF_ROOT}/`,
  ]);
  if (!output) return 0;
  let deleted = 0;
  for (const refName of output.split('\n')) {
    const trimmed = refName.trim();
    if (!trimmed) continue;
    try {
      await runGit(repoPath, ['update-ref', '-d', trimmed]);
      deleted++;
    } catch {
      // Best-effort cleanup — a stale ref must never block teardown.
    }
  }
  return deleted;
}
