import { existsSync, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import {
  loadWorkflowPolicyUncached,
  peekWorkflowPolicyCache,
  setWorkflowPolicyCache,
  type WorkflowLoadWarning,
  type WorkflowPolicy,
} from './workflow-loader';

/**
 * Default debounce window for coalescing rapid file-system events (e.g. an
 * editor's write-then-rename save) into a single reload. Symphony §6.2 uses the
 * same 200ms figure.
 */
export const DEFAULT_WORKFLOW_RELOAD_DEBOUNCE_MS = 200;

export interface WorkflowReloadEvent {
  repoPath: string;
  /** Resolved WORKFLOW.md path at reload time, or null when none exists. */
  path: string | null;
  /** True when the file parsed cleanly and the new policy was applied. */
  ok: boolean;
  /**
   * Effective policy after the reload: the freshly-parsed policy on success, or
   * the preserved last-known-good policy on failure.
   */
  policy: WorkflowPolicy;
  /** Parse/read warning when `ok` is false; null on success. */
  warning: WorkflowLoadWarning | null;
}

export interface WorkflowWatcher {
  /** Stop watching and cancel any pending debounced reload. Idempotent. */
  close(): void;
}

/** Minimal handle returned by a watch factory; `close()` must stop the watch. */
export interface WorkflowWatchHandle {
  close(): void;
}

/**
 * Starts watching a single directory, invoking `onChange` on any entry change.
 * Returns null when the directory cannot be watched (e.g. it does not exist).
 */
export type WorkflowWatchFactory = (
  dir: string,
  onChange: () => void,
) => WorkflowWatchHandle | null;

export interface CreateWorkflowWatcherOptions {
  /** Absolute path to the project repo root. */
  repoPath: string;
  /** Invoked after each debounced reload with the outcome. */
  onReload: (event: WorkflowReloadEvent) => void;
  /** Debounce window in ms. Defaults to {@link DEFAULT_WORKFLOW_RELOAD_DEBOUNCE_MS}. */
  debounceMs?: number;
  // --- Injectable seams (tests) ---
  watchFactory?: WorkflowWatchFactory;
  /** Existence check for the `.shipcode` dir; defaults to `fs.existsSync`. */
  pathExists?: (dir: string) => boolean;
  loadUncached?: (repoPath: string) => WorkflowPolicy;
  peekCache?: (repoPath: string) => WorkflowPolicy | null;
  setCache?: (repoPath: string, policy: WorkflowPolicy) => void;
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

const defaultWatchFactory: WorkflowWatchFactory = (dir, onChange) => {
  try {
    const watcher = fsWatch(dir, { persistent: false }, () => onChange());
    // A watched dir can be removed out from under us (e.g. `.shipcode` deleted);
    // swallow the resulting error rather than crashing the main process.
    watcher.on('error', () => {});
    return { close: () => watcher.close() };
  } catch {
    // Directory not watchable (most commonly: it does not exist yet).
    return null;
  }
};

/**
 * Watch a project's WORKFLOW.md (in `.shipcode/` and the repo root) and reload
 * its policy on change. A valid reload is committed to the loader cache
 * immediately so the next dispatch tick observes it without waiting out the 30s
 * TTL; an invalid reload preserves the last-known-good policy and reports the
 * warning. In-flight pipelines are unaffected — they snapshot their policy at
 * start (see `pipeline/context.ts`).
 */
export function createWorkflowWatcher(options: CreateWorkflowWatcherOptions): WorkflowWatcher {
  const {
    repoPath,
    onReload,
    debounceMs = DEFAULT_WORKFLOW_RELOAD_DEBOUNCE_MS,
    watchFactory = defaultWatchFactory,
    pathExists = existsSync,
    loadUncached = loadWorkflowPolicyUncached,
    peekCache = peekWorkflowPolicyCache,
    setCache = setWorkflowPolicyCache,
    setTimeoutFn = setTimeout as NonNullable<CreateWorkflowWatcherOptions['setTimeoutFn']>,
    clearTimeoutFn = clearTimeout as NonNullable<CreateWorkflowWatcherOptions['clearTimeoutFn']>,
  } = options;

  // Watch both candidate locations: the repo root catches a top-level
  // `WORKFLOW.md` (and creation/removal of `.shipcode`), while the `.shipcode`
  // dir catches the preferred `.shipcode/WORKFLOW.md` (fs.watch is not recursive).
  const shipcodeDir = path.join(repoPath, '.shipcode');
  const handles: WorkflowWatchHandle[] = [];
  // Tracked separately so it can be lazily attached: when `.shipcode` does not
  // exist at startup the factory returns null, and without this the directory
  // would never be watched even after the user later creates it.
  let shipcodeHandle: WorkflowWatchHandle | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const runReload = (): void => {
    pending = null;
    if (closed) return;

    const prior = peekCache(repoPath);
    const candidate = loadUncached(repoPath);

    if (candidate.warning) {
      // Invalid reload: keep the last-known-good policy so dispatch is unaffected.
      if (prior) setCache(repoPath, prior);
      onReload({
        repoPath,
        path: candidate.path,
        ok: false,
        policy: prior ?? candidate,
        warning: candidate.warning,
      });
      return;
    }

    setCache(repoPath, candidate);
    onReload({ repoPath, path: candidate.path, ok: true, policy: candidate, warning: null });
  };

  const onChange = (): void => {
    if (closed) return;
    // If `.shipcode` was removed, drop the now-stale handle (and stop tracking
    // it) so a later recreation can re-attach on the next root-watcher event —
    // otherwise the `!shipcodeHandle` gate below would skip the re-attach.
    if (shipcodeHandle && !pathExists(shipcodeDir)) {
      try {
        shipcodeHandle.close();
      } catch {
        // Best-effort — the underlying watch may already be invalid.
      }
      const index = handles.indexOf(shipcodeHandle);
      if (index !== -1) handles.splice(index, 1);
      shipcodeHandle = null;
    }
    // Lazily attach the `.shipcode` watcher once the directory appears. The
    // root watcher fires when `.shipcode` is first created; without this retry
    // the non-recursive watch would never observe later edits to
    // `.shipcode/WORKFLOW.md` until the app restarts.
    if (!shipcodeHandle) {
      const handle = watchFactory(shipcodeDir, onChange);
      if (handle) {
        shipcodeHandle = handle;
        handles.push(handle);
      }
    }
    if (pending) clearTimeoutFn(pending);
    pending = setTimeoutFn(runReload, debounceMs);
  };

  const rootHandle = watchFactory(repoPath, onChange);
  if (rootHandle) handles.push(rootHandle);
  shipcodeHandle = watchFactory(shipcodeDir, onChange);
  if (shipcodeHandle) handles.push(shipcodeHandle);

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (pending) {
        clearTimeoutFn(pending);
        pending = null;
      }
      for (const handle of handles) {
        try {
          handle.close();
        } catch {
          // Best-effort teardown — a handle may already be invalid.
        }
      }
      handles.length = 0;
      shipcodeHandle = null;
    },
  };
}
