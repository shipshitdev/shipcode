import type { CreateWorkflowWatcherOptions, WorkflowWatcher } from '@shipcode/pipeline';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowWatchManager } from './workflow-watch-manager';

function setup() {
  const created: Array<{ repoPath: string; close: ReturnType<typeof vi.fn> }> = [];
  const createWatcher = vi.fn((options: CreateWorkflowWatcherOptions): WorkflowWatcher => {
    const close = vi.fn();
    created.push({ repoPath: options.repoPath, close });
    return { close };
  });
  const onReload = vi.fn();
  const manager = new WorkflowWatchManager({ onReload, createWatcher });
  return { manager, createWatcher, created, onReload };
}

describe('WorkflowWatchManager', () => {
  it('creates one watcher per project path', () => {
    const { manager, createWatcher, created, onReload } = setup();

    manager.sync(['/a', '/b']);

    expect(created.map((w) => w.repoPath)).toEqual(['/a', '/b']);
    expect(createWatcher).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: '/a', onReload }),
    );
  });

  it('is idempotent — re-syncing the same paths creates no new watchers', () => {
    const { manager, createWatcher, created } = setup();

    manager.sync(['/a', '/b']);
    manager.sync(['/a', '/b']);

    expect(createWatcher).toHaveBeenCalledTimes(2);
    expect(created.every((w) => !w.close.mock.calls.length)).toBe(true);
  });

  it('closes watchers for paths that disappear and keeps the rest', () => {
    const { manager, created } = setup();

    manager.sync(['/a', '/b']);
    manager.sync(['/a']);

    const a = created.find((w) => w.repoPath === '/a');
    const b = created.find((w) => w.repoPath === '/b');
    expect(b?.close).toHaveBeenCalledTimes(1);
    expect(a?.close).not.toHaveBeenCalled();
  });

  it('adds a watcher for a newly-appearing path', () => {
    const { manager, created } = setup();

    manager.sync(['/a']);
    manager.sync(['/a', '/c']);

    expect(created.map((w) => w.repoPath)).toEqual(['/a', '/c']);
  });

  it('dispose() closes every watcher and clears state', () => {
    const { manager, created } = setup();

    manager.sync(['/a', '/b']);
    manager.dispose();

    expect(created.every((w) => w.close.mock.calls.length === 1)).toBe(true);

    // After dispose, a fresh sync re-creates watchers rather than reusing closed ones.
    manager.sync(['/a']);
    expect(created.filter((w) => w.repoPath === '/a')).toHaveLength(2);
  });
});
