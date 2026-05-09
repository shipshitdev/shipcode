import type { IssuePipelineStatus, PipelinePhase } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';

const PHASE_TEXT_CLASS: Record<string, string> = {
  planning: 'text-agent',
  clarifying: 'text-warning',
  reviewing: 'text-agent',
  revising: 'text-agent',
  executing: 'text-agent',
  testing: 'text-agent',
  verifying: 'text-agent',
  shipping: 'text-agent',
  paused: 'text-warning',
  approval: 'text-warning',
  completed: 'text-success',
  closed: 'text-done',
  failed: 'text-danger',
  todo: '',
  queued: '',
  idle: '',
};

export function PhaseChip({
  status,
  label,
  className,
}: {
  status: IssuePipelineStatus | PipelinePhase;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="default" className={cn('uppercase', PHASE_TEXT_CLASS[status], className)}>
      {(label ?? status).replace(/_/g, ' ')}
    </Badge>
  );
}
