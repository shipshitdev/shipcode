import {
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type PipelinePhase,
} from './types';

/**
 * Maps a pipeline phase/status to a deterministic progress percentage (0–100).
 * Used to render a real progress bar on Kanban cards and phase steppers.
 * Values are weighted by approximate real-world time share, not equal steps.
 */
export function phaseToProgress(phase: PipelinePhase | IssuePipelineStatus): number {
  const MAP: Record<string, number> = {
    [PIPELINE_PHASE.idle]: 0,
    [ISSUE_PIPELINE_STATUS.todo]: 0,
    [ISSUE_PIPELINE_STATUS.queued]: 2,
    [PIPELINE_PHASE.planning]: 12,
    [PIPELINE_PHASE.clarifying]: 20,
    [PIPELINE_PHASE.reviewing]: 28,
    [PIPELINE_PHASE.revising]: 38,
    [PIPELINE_PHASE.approval]: 48,
    [PIPELINE_PHASE.executing]: 72,
    [PIPELINE_PHASE.testing]: 82,
    [PIPELINE_PHASE.verifying]: 90,
    [PIPELINE_PHASE.shipping]: 96,
    [ISSUE_PIPELINE_STATUS.needsReview]: 92,
    [ISSUE_PIPELINE_STATUS.readyToMerge]: 96,
    [PIPELINE_PHASE.paused]: 72,
    [PIPELINE_PHASE.completed]: 92,
    [ISSUE_PIPELINE_STATUS.closed]: 100,
    [ISSUE_PIPELINE_STATUS.deferred]: 0,
    [PIPELINE_PHASE.failed]: 0,
  };
  return MAP[phase] ?? 0;
}
