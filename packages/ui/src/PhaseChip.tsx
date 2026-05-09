import type { IssuePipelineStatus, PipelinePhase } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';

type BadgeVariant = 'default' | 'agent' | 'warning' | 'success' | 'danger' | 'done' | 'info';

const PHASE_VARIANT: Record<string, BadgeVariant> = {
  planning: 'agent',
  clarifying: 'warning',
  reviewing: 'agent',
  revising: 'agent',
  executing: 'agent',
  testing: 'agent',
  verifying: 'agent',
  shipping: 'agent',
  paused: 'warning',
  approval: 'warning',
  completed: 'success',
  closed: 'done',
  failed: 'danger',
  todo: 'default',
  queued: 'default',
  idle: 'default',
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
    <Badge variant={PHASE_VARIANT[status] ?? 'default'} className={cn('uppercase', className)}>
      {(label ?? status).replace(/_/g, ' ')}
    </Badge>
  );
}
