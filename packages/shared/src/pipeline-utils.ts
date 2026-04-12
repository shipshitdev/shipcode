import type { IssuePipelineStatus, PipelinePhase } from './types';

/**
 * Maps a pipeline phase/status to a deterministic progress percentage (0–100).
 * Used to render a real progress bar on Kanban cards and phase steppers.
 * Values are weighted by approximate real-world time share, not equal steps.
 */
export function phaseToProgress(phase: PipelinePhase | IssuePipelineStatus): number {
  const MAP: Record<string, number> = {
    idle: 0,
    todo: 0,
    queued: 2,
    planning: 12,
    reviewing: 28,
    revising: 38,
    awaiting_approval: 48,
    executing: 72,
    testing: 82,
    verifying: 90,
    shipping: 96,
    completed: 100,
    failed: 0,
  };
  return MAP[phase] ?? 0;
}
