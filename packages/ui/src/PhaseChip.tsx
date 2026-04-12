import type { IssuePipelineStatus, PipelinePhase } from '@shipcode/shared';

const AGENT_PHASE_CLASSES = 'bg-agent/10 text-agent border-agent/25';

const PHASE_COLOR: Record<string, string> = {
  planning: AGENT_PHASE_CLASSES,
  reviewing: AGENT_PHASE_CLASSES,
  revising: AGENT_PHASE_CLASSES,
  executing: AGENT_PHASE_CLASSES,
  verifying: AGENT_PHASE_CLASSES,
  shipping: AGENT_PHASE_CLASSES,
  awaiting_approval: 'bg-warning/15 text-warning border-warning/30',
  completed: 'bg-success/15 text-success border-success/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  todo: 'bg-tertiary text-muted border-border',
  queued: 'bg-tertiary text-muted border-border',
  idle: 'bg-tertiary text-muted border-border',
};

const FALLBACK = 'bg-tertiary text-muted border-border';

export function PhaseChip({ status }: { status: IssuePipelineStatus | PipelinePhase }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        PHASE_COLOR[status] ?? FALLBACK
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
