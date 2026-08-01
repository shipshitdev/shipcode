import path from 'node:path';
import { simpleGit } from 'simple-git';

/**
 * Shared async git transport for hot paths.
 *
 * Synchronous git (`execFileSync`) blocks the Electron main-process event loop
 * for the full duration of the subprocess — `git add -A` on a large worktree is
 * not fast — which freezes the UI, stalls IPC, and prevents the pipeline
 * heartbeat from being written. Everything on the execute path must route
 * through here instead.
 *
 * The transport is simple-git, matching git-service / worktree / checkpoint, so
 * a failed command surfaces as simple-git's parsed GitError (stderr / exitCode)
 * rather than a raw execFile Error, and callers wrapping git-service ops and
 * these ops in one try/catch see a single, consistent error shape.
 */

/**
 * Env vars simple-git's block-unsafe-operations guard rejects the moment they
 * appear in an explicit `.env()` object — the editor / pager / askpass / ssh /
 * external-diff / proxy / template knobs plus the config-path overrides a
 * hostile repo could turn into code execution. simple-git flags them even when
 * they merely rode in from the user's ambient shell, so we drop them from the
 * spread below. Callers here run only non-interactive plumbing that never
 * consults any of these, making the removal behavior-neutral. Names mirror
 * simple-git@3.36.0's guard list and are matched case-insensitively (the guard
 * lowercases before comparing).
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
export function buildScopedGitEnv(overrides: Record<string, string>): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SIMPLE_GIT_UNSAFE_ENV_KEYS.has(key.toUpperCase())) {
      childEnv[key] = value;
    }
  }
  return Object.assign(childEnv, overrides);
}

/**
 * Run a git command in `cwd` and return its trimmed stdout, WITHOUT taking the
 * per-working-tree lock.
 *
 * Use this only for a standalone command whose result cannot be invalidated by
 * a concurrent git call, or from inside a {@link withGitLock} callback that
 * already holds the lock. Anything that stages, commits, or reads a value it
 * then acts on must go through {@link runGit} or {@link withGitLock}.
 *
 * With no `env`, simple-git inherits the ambient environment untouched (the
 * guard only scans an explicit `.env()` object). With overrides, `.env()`
 * replaces the child environment wholesale, so we hand it a sanitized copy of
 * the ambient env plus the overrides — see {@link buildScopedGitEnv}.
 */
export async function runGitUnlocked(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  const git = env ? simpleGit(cwd).env(buildScopedGitEnv(env)) : simpleGit(cwd);
  const stdout = await git.raw(args);
  return stdout.trim();
}

/** Runs a git command inside an already-held {@link withGitLock} section. */
export type GitRunner = (args: string[], env?: Record<string, string>) => Promise<string>;

/**
 * Tail of the pending command chain per working tree, keyed by resolved path.
 * Entries are deleted once their chain drains, so the map stays proportional to
 * in-flight work rather than to every worktree ever touched.
 */
const gitQueues = new Map<string, Promise<unknown>>();

/**
 * Serialize a git command sequence against everything else running in the same
 * working tree.
 *
 * `execFileSync` used to make sequences like `status` → `add -A` → `commit`
 * implicitly atomic: nothing else in the process could run between the calls.
 * Awaiting gives that back up — another pipeline thread could stage its own
 * changes into the shared index between our `add` and our `commit`, or trip
 * over `index.lock`. Wrapping the whole sequence in one `withGitLock` call
 * restores the atomicity without blocking the event loop.
 *
 * Locks are per resolved `cwd`, so separate worktrees (fan-out workers each get
 * their own, and each worktree has its own index) still run fully in parallel.
 *
 * NOT reentrant: inside the callback use the supplied `run`, never the exported
 * {@link runGit} or a nested `withGitLock` on the same `cwd` — that self-
 * deadlocks.
 */
export async function withGitLock<T>(cwd: string, fn: (run: GitRunner) => Promise<T>): Promise<T> {
  const key = path.resolve(cwd);
  const previous = gitQueues.get(key) ?? Promise.resolve();
  const run: GitRunner = (args, env) => runGitUnlocked(cwd, args, env);
  // Chain off the previous holder's settled state so one caller's rejection
  // never poisons or stalls the queue for the next.
  const task = previous.then(
    () => fn(run),
    () => fn(run),
  );
  const tail = task.then(
    () => undefined,
    () => undefined,
  );
  gitQueues.set(key, tail);
  try {
    return await task;
  } finally {
    // Only the last enqueued caller clears the entry; earlier ones leave the
    // newer tail in place.
    if (gitQueues.get(key) === tail) gitQueues.delete(key);
  }
}

/**
 * Run a single git command in `cwd` under the working tree's lock, returning
 * trimmed stdout. The lock-taking default — prefer this over
 * {@link runGitUnlocked} unless you are already inside a {@link withGitLock}
 * section.
 */
export async function runGit(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  return withGitLock(cwd, (run) => run(args, env));
}
