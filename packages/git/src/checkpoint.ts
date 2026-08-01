import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';

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
 * Env vars simple-git's block-unsafe-operations guard rejects the moment they
 * appear in an explicit `.env()` object — the editor / pager / askpass / ssh /
 * external-diff / proxy / template knobs plus the config-path overrides a
 * hostile repo could turn into code execution. simple-git flags them even when
 * they merely rode in from the user's ambient shell, so we drop them from the
 * spread below. Checkpoint runs only non-interactive local plumbing
 * (read-tree / write-tree / commit-tree / update-ref / for-each-ref / ls-tree /
 * restore / reset / clean) that never consults any of these, making the removal
 * behavior-neutral. Names mirror simple-git@3.36.0's guard list and are matched
 * case-insensitively (the guard lowercases before comparing).
 */
const SIMPLE_GIT_UNSAFE_ENV_KEYS = new Set([
  'EDITOR',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_EDITOR',
  'GIT_EXEC_PATH',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'PAGER',
  'PREFIX',
  'SSH_ASKPASS',
]);

/**
 * Build the child environment for an env-scoped git call: inherit the ambient
 * environment (PATH, HOME, GIT_DIR, alternates, …) minus the keys simple-git's
 * safety guard blocks, then layer the caller's overrides on top. The overrides
 * (GIT_INDEX_FILE for the temp-index trick, the ShipCode author/committer
 * identity) are never in the blocked set, so the resulting object passes the
 * guard cleanly.
 */
function buildScopedGitEnv(overrides: Record<string, string>): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SIMPLE_GIT_UNSAFE_ENV_KEYS.has(key.toUpperCase())) {
      childEnv[key] = value;
    }
  }
  return Object.assign(childEnv, overrides);
}

/**
 * Run a git command in `cwd` and return its trimmed stdout.
 *
 * Routes through simple-git — the transport every other module in this package
 * (git-service, worktree) already uses — so a failed git command surfaces as
 * simple-git's parsed GitError (stderr / exitCode) rather than a raw execFile
 * Error. Callers wrapping checkpoint ops and git-service ops in one try/catch
 * then see a single, consistent error shape.
 *
 * With no `env`, simple-git inherits the ambient environment untouched (the
 * guard only scans an explicit `.env()` object), matching the prior execFile
 * transport exactly. With overrides, `.env()` replaces the child environment
 * wholesale, so we hand it a sanitized copy of the ambient env plus the
 * overrides — see buildScopedGitEnv.
 */
async function runGit(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const git = env ? simpleGit(cwd).env(buildScopedGitEnv(env)) : simpleGit(cwd);
  const stdout = await git.raw(args);
  return stdout.trim();
}

/**
 * Run a git command that reads its input from stdin.
 *
 * simple-git has no stdin channel, so this is the one place in the module that
 * spawns git directly — used solely for `update-ref --stdin`, whose batch form
 * has no argv equivalent.
 */
function runGitWithStdin(cwd: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(' ')} exited with ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

/**
 * Delete a set of checkpoint refs in a single `update-ref` transaction.
 *
 * These deletions are logically independent, but they are *not* safe to run
 * concurrently: git takes `packed-refs.lock` for any ref deletion, so parallel
 * `update-ref -d` processes contend on one lock with a short retry timeout and
 * start failing. Batching is the win a `Promise.all` cannot be — one process,
 * one lock, one pass.
 *
 * The transaction is all-or-nothing (a ref deleted out from under us fails the
 * whole batch), so on any failure we fall back to the per-ref loop. That keeps
 * the documented best-effort contract: skip what cannot be deleted, return how
 * many actually were.
 */
async function deleteRefsBatch(repoPath: string, refNames: string[]): Promise<number> {
  if (refNames.length === 0) return 0;

  // `-z` format: `delete SP <ref> NUL [<old-oid>] NUL`. An empty old-oid deletes
  // unconditionally, and NUL separators sidestep refname quoting entirely.
  const commands = refNames.map((refName) => `delete ${refName}\0\0`).join('');
  try {
    await runGitWithStdin(repoPath, ['update-ref', '-z', '--stdin'], commands);
    return refNames.length;
  } catch {
    let deleted = 0;
    for (const refName of refNames) {
      try {
        await runGit(repoPath, ['update-ref', '-d', refName]);
        deleted++;
      } catch {
        // Best-effort cleanup — a stale ref must never block teardown.
      }
    }
    return deleted;
  }
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
  return deleteRefsBatch(
    repoPath,
    targets.map((ref) => ref.refName),
  );
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
  const refNames = output
    .split('\n')
    .map((refName) => refName.trim())
    .filter(Boolean);
  return deleteRefsBatch(repoPath, refNames);
}
