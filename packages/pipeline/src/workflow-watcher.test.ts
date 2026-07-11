import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKFLOW_POLICY, type WorkflowPolicy } from './workflow-loader';
import {
  createWorkflowWatcher,
  type WorkflowReloadEvent,
  type WorkflowWatchFactory,
} from './workflow-watcher';

const REPO = '/repo';

function validPolicy(overrides: Partial<WorkflowPolicy> = {}): WorkflowPolicy {
  return {
    ...DEFAULT_WORKFLOW_POLICY,
    path: path.join(REPO, '.shipcode', 'WORKFLOW.md'),
    promptTemplate: 'do the thing',
    ...overrides,
  };
}

function invalidPolicy(): WorkflowPolicy {
  const sourcePath = path.join(REPO, '.shipcode', 'WORKFLOW.md');
  return {
    ...DEFAULT_WORKFLOW_POLICY,
    path: sourcePath,
    warning: {
      code: 'workflow_parse_error',
      message: 'bad yaml',
      path: sourcePath,
    },
  };
}

/** A controllable fake clock for the debounce timer. */
function fakeTimers() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimeoutFn: ((handler: () => void) => {
      const id = nextId++;
      timers.set(id, handler);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as (handler: () => void, ms: number) => ReturnType<typeof setTimeout>,
    clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    },
    /** Fire all currently-scheduled timers (in scheduling order). */
    flush: () => {
      const handlers = [...timers.values()];
      timers.clear();
      for (const handler of handlers) handler();
    },
    pendingCount: () => timers.size,
  };
}

/** A fake watch factory that records watched dirs and lets a test trigger changes. */
function fakeWatch() {
  const watchedDirs: string[] = [];
  const closedDirs: string[] = [];
  let changeHandler: (() => void) | null = null;
  const factory: WorkflowWatchFactory = (dir, onChange) => {
    watchedDirs.push(dir);
    changeHandler = onChange;
    return { close: () => closedDirs.push(dir) };
  };
  return {
    factory,
    watchedDirs,
    closedDirs,
    trigger: () => changeHandler?.(),
  };
}

describe('createWorkflowWatcher', () => {
  it('watches the repo root and the .shipcode directory', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();

    createWorkflowWatcher({
      repoPath: REPO,
      onReload: vi.fn(),
      watchFactory: watch.factory,
      loadUncached: vi.fn(() => validPolicy()),
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    expect(watch.watchedDirs).toEqual([REPO, path.join(REPO, '.shipcode')]);
  });

  it('applies a valid reload to the cache and emits ok', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();
    const onReload = vi.fn<(event: WorkflowReloadEvent) => void>();
    const setCache = vi.fn();
    const fresh = validPolicy({ promptTemplate: 'updated prompt' });

    createWorkflowWatcher({
      repoPath: REPO,
      onReload,
      watchFactory: watch.factory,
      loadUncached: vi.fn(() => fresh),
      peekCache: vi.fn(() => validPolicy()),
      setCache,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watch.trigger();
    timers.flush();

    expect(setCache).toHaveBeenCalledWith(REPO, fresh);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onReload.mock.calls[0]?.[0]).toMatchObject({
      repoPath: REPO,
      ok: true,
      policy: fresh,
      warning: null,
    });
  });

  it('coalesces rapid changes into a single debounced reload', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();
    const onReload = vi.fn();
    const loadUncached = vi.fn(() => validPolicy());

    createWorkflowWatcher({
      repoPath: REPO,
      onReload,
      watchFactory: watch.factory,
      loadUncached,
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watch.trigger();
    watch.trigger();
    watch.trigger();
    // Only the last timer should remain scheduled (earlier ones cleared).
    expect(timers.pendingCount()).toBe(1);

    timers.flush();

    expect(loadUncached).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('preserves the prior policy on an invalid reload', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();
    const onReload = vi.fn<(event: WorkflowReloadEvent) => void>();
    const setCache = vi.fn();
    const prior = validPolicy({ promptTemplate: 'known good' });

    createWorkflowWatcher({
      repoPath: REPO,
      onReload,
      watchFactory: watch.factory,
      loadUncached: vi.fn(() => invalidPolicy()),
      peekCache: vi.fn(() => prior),
      setCache,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watch.trigger();
    timers.flush();

    // The known-good policy is re-asserted; the invalid candidate is discarded.
    expect(setCache).toHaveBeenCalledWith(REPO, prior);
    const event = onReload.mock.calls[0]?.[0];
    expect(event).toMatchObject({ ok: false, policy: prior });
    expect(event?.warning?.code).toBe('workflow_parse_error');
  });

  it('does not write to the cache on an invalid reload when nothing is cached', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();
    const onReload = vi.fn<(event: WorkflowReloadEvent) => void>();
    const setCache = vi.fn();

    createWorkflowWatcher({
      repoPath: REPO,
      onReload,
      watchFactory: watch.factory,
      loadUncached: vi.fn(() => invalidPolicy()),
      peekCache: vi.fn(() => null),
      setCache,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watch.trigger();
    timers.flush();

    expect(setCache).not.toHaveBeenCalled();
    expect(onReload.mock.calls[0]?.[0]).toMatchObject({ ok: false });
  });

  it('close() stops watchers and cancels a pending reload', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();
    const onReload = vi.fn();

    const watcher = createWorkflowWatcher({
      repoPath: REPO,
      onReload,
      watchFactory: watch.factory,
      pathExists: () => true,
      loadUncached: vi.fn(() => validPolicy()),
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watch.trigger(); // schedule a reload
    watcher.close();

    expect(watch.closedDirs).toEqual([REPO, path.join(REPO, '.shipcode')]);
    expect(timers.pendingCount()).toBe(0);

    timers.flush(); // nothing should run
    expect(onReload).not.toHaveBeenCalled();
  });

  it('lazily attaches the .shipcode watcher once the directory appears', () => {
    const timers = fakeTimers();
    const onReload = vi.fn();
    const loadUncached = vi.fn(() => validPolicy());
    const shipcodeDir = path.join(REPO, '.shipcode');
    const watchedDirs: string[] = [];
    let shipcodeAttempts = 0;
    // Held in an object so TS doesn't narrow it to `null` across the callback.
    const root: { change: (() => void) | null } = { change: null };

    // `.shipcode` is missing at startup (factory returns null), then present on
    // the retry triggered by the root watcher firing.
    const factory: WorkflowWatchFactory = (dir, onChange) => {
      watchedDirs.push(dir);
      if (dir === shipcodeDir) {
        shipcodeAttempts += 1;
        return shipcodeAttempts === 1 ? null : { close: () => {} };
      }
      root.change = onChange;
      return { close: () => {} };
    };

    createWorkflowWatcher({
      repoPath: REPO,
      onReload,
      watchFactory: factory,
      pathExists: () => true,
      loadUncached,
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    // Startup: root watched, .shipcode attempted but absent.
    expect(watchedDirs).toEqual([REPO, shipcodeDir]);

    // Root watcher fires (e.g. .shipcode was just created) → lazy re-attach.
    root.change?.();
    expect(watchedDirs).toEqual([REPO, shipcodeDir, shipcodeDir]);
    timers.flush();
    expect(loadUncached).toHaveBeenCalledTimes(1);

    // A later edit reloads without attempting yet another attach (already held).
    root.change?.();
    expect(watchedDirs).toEqual([REPO, shipcodeDir, shipcodeDir]);
    timers.flush();
    expect(loadUncached).toHaveBeenCalledTimes(2);
  });

  it('drops a stale .shipcode handle and re-attaches after the dir is recreated', () => {
    const timers = fakeTimers();
    const shipcodeDir = path.join(REPO, '.shipcode');
    let shipcodeExists = true;
    let shipcodeAttaches = 0;
    const root: { change: (() => void) | null } = { change: null };

    const factory: WorkflowWatchFactory = (dir, onChange) => {
      if (dir === shipcodeDir) {
        if (!shipcodeExists) return null;
        shipcodeAttaches += 1;
        return { close: () => {} };
      }
      root.change = onChange;
      return { close: () => {} };
    };

    createWorkflowWatcher({
      repoPath: REPO,
      onReload: vi.fn(),
      watchFactory: factory,
      pathExists: (dir) => (dir === shipcodeDir ? shipcodeExists : true),
      loadUncached: vi.fn(() => validPolicy()),
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    // Startup attaches the .shipcode watcher once.
    expect(shipcodeAttaches).toBe(1);

    // .shipcode removed: the next root event drops the stale handle; the attach
    // retry returns null while the dir is absent, so no new handle is held.
    shipcodeExists = false;
    root.change?.();
    timers.flush();
    expect(shipcodeAttaches).toBe(1);

    // .shipcode recreated: because the stale handle was cleared, the next root
    // event re-attaches (without the drop, the !shipcodeHandle gate would skip).
    shipcodeExists = true;
    root.change?.();
    timers.flush();
    expect(shipcodeAttaches).toBe(2);
  });

  it('ignores watch events fired after close()', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();
    const loadUncached = vi.fn(() => validPolicy());

    const watcher = createWorkflowWatcher({
      repoPath: REPO,
      onReload: vi.fn(),
      watchFactory: watch.factory,
      pathExists: () => true,
      loadUncached,
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watcher.close();
    // A late fs event (the underlying watch had already queued it) must be a
    // no-op: onChange returns early because the watcher is closed.
    watch.trigger();

    expect(timers.pendingCount()).toBe(0);
    timers.flush();
    expect(loadUncached).not.toHaveBeenCalled();
  });

  describe('default fs.watch factory', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('watches a real directory and returns null for a missing one', () => {
      const repo = mkdtempSync(path.join(os.tmpdir(), 'shipcode-watcher-'));
      tempDirs.push(repo);
      const timers = fakeTimers();

      // No injected watchFactory → exercises the real fs.watch-backed default:
      // the repo root exists (watch attaches) while `.shipcode` is absent (the
      // factory's try/catch returns null instead of crashing).
      const watcher = createWorkflowWatcher({
        repoPath: repo,
        onReload: vi.fn(),
        loadUncached: vi.fn(() => validPolicy()),
        peekCache: vi.fn(() => null),
        setCache: vi.fn(),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      });

      // Tearing down a real watcher must not throw.
      expect(() => watcher.close()).not.toThrow();
    });
  });

  it('close() is idempotent', () => {
    const watch = fakeWatch();
    const timers = fakeTimers();

    const watcher = createWorkflowWatcher({
      repoPath: REPO,
      onReload: vi.fn(),
      watchFactory: watch.factory,
      loadUncached: vi.fn(() => validPolicy()),
      peekCache: vi.fn(() => null),
      setCache: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    watcher.close();
    watcher.close();

    // Each watched dir closed exactly once despite the second close() call.
    expect(watch.closedDirs).toEqual([REPO, path.join(REPO, '.shipcode')]);
  });
});
