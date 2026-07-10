import { GhCli } from '@shipcode/agents';
import {
  isPipelineStateLabel,
  macroColumnForStatus,
  type Project,
  pipelineLabelForStatus,
} from '@shipcode/shared';
import { GhSyncQueue, type GhSyncWriteOpts } from './gh-sync-queue';
import type { GhSyncDeps } from './phase-sync';

// ---------------------------------------------------------------------------
// Shared GH Status/label sync service — the single writer for GH Projects v2
// Status field + pipeline-state labels. Owns one serialized GhSyncQueue keyed
// per issue so runtime phase transitions, manual/board-driven transitions,
// and refresh-triggered writes all collapse through the same queue instead of
// racing across independent implementations.
// ---------------------------------------------------------------------------

export interface GhSyncService {
  /** Enqueue a GH write for a single state snapshot. Fire-and-forget. */
  enqueue: (opts: GhSyncWriteOpts) => void;
  /** Stable GhSyncDeps-shaped object for syncThreadAndIssuePhase consumers. */
  deps: GhSyncDeps;
}

/** Perform the actual GH write for a single state snapshot. */
async function performGhSync(opts: GhSyncWriteOpts): Promise<void> {
  const ghCli = new GhCli(opts.projectPath);

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
            : opts.statusMapping.done?.name;
    if (ghStatusName) {
      try {
        await ghCli.setIssueProjectMetadata({
          issueNumber: opts.issueNumber,
          projectUrl: opts.projectUrl,
          metadata: { status: ghStatusName },
        });
      } catch (err) {
        console.warn('[gh-status-sync] setIssueProjectMetadata failed', err);
      }
    }
  }

  // 2. Toggle pipeline labels on every state update — remove stale, set current.
  const targetLabel = pipelineLabelForStatus(opts.pipelineStatus);
  try {
    const issue = await ghCli.getIssue(opts.issueNumber);
    const currentPipelineLabels = issue.labels.filter(isPipelineStateLabel);
    for (const old of currentPipelineLabels) {
      if (old !== targetLabel) {
        await ghCli.setIssueLabelPresence(opts.issueNumber, old, false);
      }
    }
    if (targetLabel) {
      await ghCli.setIssueLabelPresence(opts.issueNumber, targetLabel, true);
    }
  } catch (err) {
    console.warn('[gh-status-sync] pipeline label sync failed', err);
  }
}

/**
 * Create the single shared GH Status/label sync service. Callers should
 * construct exactly one instance per process (desktop main) or per pipeline
 * runtime fallback, and share it across every write path — runtime phase
 * transitions, manual/board-driven transitions, and refresh reconciliation.
 */
export function createGhSyncService(options: {
  getProject: (projectId: string) => Project | null;
}): GhSyncService {
  const queue = new GhSyncQueue(performGhSync, (err) => {
    console.warn('[gh-status-sync] queued write failed', err);
  });

  const enqueue = (opts: GhSyncWriteOpts): void => {
    queue.enqueue(opts);
  };

  return {
    enqueue,
    deps: {
      getProject: options.getProject,
      syncToGithub: async (opts) => {
        enqueue(opts);
      },
    },
  };
}
