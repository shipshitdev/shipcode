import { GhCli } from '@shipcode/agents';
import {
  isPipelineStateLabel,
  isRealGithubIssueNumber,
  macroColumnForStatus,
  type Project,
  pipelineLabelForStatus,
} from '@shipcode/shared';
import {
  GhSyncQueue,
  type GhSyncQueueOptions,
  type GhSyncWriteFailure,
  type GhSyncWriteOpts,
} from './gh-sync-queue';
import type { GhSyncDeps } from './phase-sync';

// ---------------------------------------------------------------------------
// Shared GH Status/label sync service — the single writer for GH Projects v2
// Status field + pipeline-state labels. Owns one serialized GhSyncQueue keyed
// per issue (by GitHub repo identity, so two local clones of one repo share a
// queue) so runtime phase transitions, manual/board-driven transitions, and
// refresh-triggered writes all collapse through the same queue instead of
// racing across independent implementations.
//
// The queue owns error handling: it retries transient failures with bounded
// backoff and reports a write that exhausts its retries through `onSyncFailure`.
// That matters because there is no backfill — reconciliation only reads
// GitHub → pipeline, so a silently dropped write is permanent drift.
// ---------------------------------------------------------------------------

export interface GhSyncService {
  /**
   * Enqueue a GH write for a single state snapshot. Fire-and-forget: a
   * persistent failure is reported through the service's failure channel, not
   * thrown at the caller. Use `deps.syncToGithub` when you want the outcome.
   */
  enqueue: (opts: GhSyncWriteOpts) => void;
  /** Stable GhSyncDeps-shaped object for syncThreadAndIssuePhase consumers. */
  deps: GhSyncDeps;
}

/**
 * Perform the actual GH write for a single state snapshot.
 *
 * Throws if any part of the write failed, so the queue can retry it. Both the
 * Status write and the label swap are attempted regardless of the other's
 * outcome — a broken Projects v2 mapping should not stop labels from moving.
 */
async function performGhSync(opts: GhSyncWriteOpts): Promise<void> {
  // Local-only quick tasks carry negative sentinel issue numbers — never write
  // them to GitHub. Guarding at the shared writer protects every caller
  // (runtime, scheduler, manual transitions, refresh), not just one call site.
  if (!isRealGithubIssueNumber(opts.issueNumber)) return;

  const ghCli = new GhCli(opts.projectPath);
  const failures: unknown[] = [];

  // 1. Write GH Projects v2 Status field when configured.
  if (opts.projectUrl && opts.statusMapping) {
    const macroCol = macroColumnForStatus(opts.pipelineStatus);
    const ghStatusName =
      macroCol === 'todo'
        ? opts.statusMapping.todo?.name
        : macroCol === 'in_progress'
          ? opts.statusMapping.inProgress?.name
          : macroCol === 'human_review'
            ? opts.statusMapping.humanReview?.name
            : macroCol === 'deferred'
              ? opts.statusMapping.deferred?.name
              : opts.statusMapping.done?.name;
    if (ghStatusName) {
      try {
        await ghCli.setIssueProjectMetadata({
          issueNumber: opts.issueNumber,
          projectUrl: opts.projectUrl,
          metadata: { status: ghStatusName },
        });
      } catch (err) {
        failures.push(err);
      }
    }
  }

  // 2. Toggle pipeline labels on every state update — set current, drop stale.
  //
  // Both halves travel in a single `gh issue edit` call. Doing the removals
  // first (or in separate calls) opens a window where the issue carries no
  // pipeline label at all, which hides it from board views and saved searches;
  // briefly carrying two is harmless by comparison.
  const targetLabel = pipelineLabelForStatus(opts.pipelineStatus);
  try {
    const issue = await ghCli.getIssue(opts.issueNumber);
    const currentPipelineLabels = issue.labels.filter(isPipelineStateLabel);
    const stale = currentPipelineLabels.filter((label) => label !== targetLabel);
    const alreadyLabeled = targetLabel ? currentPipelineLabels.includes(targetLabel) : true;

    if (stale.length > 0 || !alreadyLabeled) {
      await ghCli.editIssueLabels(opts.issueNumber, {
        add: targetLabel ? [targetLabel] : [],
        remove: stale,
      });
    }
  } catch (err) {
    failures.push(err);
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `gh sync failed for issue #${opts.issueNumber}`);
  }
}

/** Default persistent-failure report, matching the pipeline's logging shape. */
function reportSyncFailure(failure: GhSyncWriteFailure): void {
  const { opts, attempts, error } = failure;
  console.error(
    `[gh-status-sync] write failed for ${opts.repoFullName ?? opts.projectPath} ` +
      `issue #${opts.issueNumber} (status=${opts.pipelineStatus}) after ${attempts} attempts:`,
    error,
  );
}

/**
 * Create the single shared GH Status/label sync service. Callers should
 * construct exactly one instance per process (desktop main) or per pipeline
 * runtime fallback, and share it across every write path — runtime phase
 * transitions, manual/board-driven transitions, and refresh reconciliation.
 */
export function createGhSyncService(options: {
  getProject: (projectId: string) => Project | null;
  /**
   * Additional reporting for a write that exhausted its retries — wire this to
   * the host's logger. The default console.error report happens either way.
   */
  onSyncFailure?: (failure: GhSyncWriteFailure) => void;
  /** Retry tuning. Tests inject a no-op `sleep` to avoid paying real backoff. */
  queueOptions?: Omit<GhSyncQueueOptions, 'onError'>;
}): GhSyncService {
  const queue = new GhSyncQueue(performGhSync, {
    ...options.queueOptions,
    onError: (failure) => {
      reportSyncFailure(failure);
      options.onSyncFailure?.(failure);
    },
  });

  const enqueue = (opts: GhSyncWriteOpts): void => {
    // The queue already reported the failure through `onError`; swallow the
    // rejection here so a fire-and-forget caller never sees an unhandled one.
    void queue.enqueue(opts).catch(() => {});
  };

  return {
    enqueue,
    deps: {
      getProject: options.getProject,
      // Unlike `enqueue`, this hands back the queue's real outcome so callers
      // that want to react to a persistent failure can.
      syncToGithub: (opts) => queue.enqueue(opts),
    },
  };
}
