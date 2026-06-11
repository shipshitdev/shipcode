import {
  type CreateWorkflowWatcherOptions,
  createWorkflowWatcher,
  type WorkflowReloadEvent,
  type WorkflowWatcher,
} from '@shipcode/pipeline';

interface WorkflowWatchManagerDeps {
  /** Invoked for every reload (success or failure) across all watched projects. */
  onReload: (event: WorkflowReloadEvent) => void;
  /** Injectable for tests; defaults to the real pipeline watcher. */
  createWatcher?: (options: CreateWorkflowWatcherOptions) => WorkflowWatcher;
}

/**
 * Owns one WORKFLOW.md watcher per project repo path. The app lifecycle calls
 * {@link sync} with the current set of project paths (at startup, and whenever
 * the project list changes) and {@link dispose} on teardown. Reloads invalidate
 * the shared workflow-policy cache so the next dispatch/reconcile tick picks up
 * edits without an app restart.
 */
export class WorkflowWatchManager {
  private readonly watchers = new Map<string, WorkflowWatcher>();
  private readonly createWatcher: (options: CreateWorkflowWatcherOptions) => WorkflowWatcher;

  constructor(private readonly deps: WorkflowWatchManagerDeps) {
    this.createWatcher = deps.createWatcher ?? createWorkflowWatcher;
  }

  /** Add watchers for new paths and remove watchers for paths no longer present. */
  sync(projectPaths: readonly string[]): void {
    const desired = new Set(projectPaths);

    for (const [repoPath, watcher] of this.watchers) {
      if (!desired.has(repoPath)) {
        watcher.close();
        this.watchers.delete(repoPath);
      }
    }

    for (const repoPath of desired) {
      if (this.watchers.has(repoPath)) continue;
      this.watchers.set(repoPath, this.createWatcher({ repoPath, onReload: this.deps.onReload }));
    }
  }

  /** Stop and forget every watcher. Idempotent. */
  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
