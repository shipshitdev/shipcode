import { type PipelinePhase } from '@shipcode/shared';
import { Check, X } from 'lucide-react';
import { cn } from './lib/utils';

const PHASES: { key: PipelinePhase; label: string }[] = [
  { key: 'planning', label: 'Plan' },
  { key: 'reviewing', label: 'Review' },
  { key: 'revising', label: 'Revise' },
  { key: 'awaiting_approval', label: 'Approve' },
  { key: 'executing', label: 'Execute' },
  { key: 'verifying', label: 'Verify' },
  { key: 'shipping', label: 'Ship' },
  { key: 'completed', label: 'Done' },
];

const PHASE_ORDER = PHASES.map((p) => p.key);

interface PipelineStatusProps {
  currentPhase: PipelinePhase;
  onPhaseClick?: (phase: PipelinePhase) => void;
}

export function PipelineStatus({ currentPhase, onPhaseClick }: PipelineStatusProps) {
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  const isFailed = currentPhase === 'failed';

  return (
    <div className="flex items-center px-4 py-3 border-b border-border bg-secondary">
      {PHASES.map((phase, index) => {
        const isActive = phase.key === currentPhase;
        const isCompleted = !isFailed && currentIndex > index;
        const isFuture = !isFailed && currentIndex < index;

        return (
          <div key={phase.key} className="flex items-center">
            <button
              type="button"
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 bg-transparent border-none rounded text-muted text-xs whitespace-nowrap cursor-pointer',
                'hover:not-disabled:text-secondary',
                'disabled:cursor-default',
              )}
              onClick={() => onPhaseClick?.(phase.key)}
              disabled={isFuture}
            >
              <span
                className={cn(
                  'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold border-2 border-text-muted text-muted',
                  isActive && !isFailed && 'bg-accent border-accent text-bg-primary',
                  isCompleted && 'bg-success border-success text-bg-primary',
                  isFailed && isActive && 'bg-danger border-danger text-bg-primary',
                )}
              >
                {isCompleted ? (
                  <Check size={12} strokeWidth={3} />
                ) : isActive && isFailed ? (
                  <X size={12} strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  isActive && !isFailed && 'text-accent',
                  isCompleted && 'text-success',
                  isFailed && isActive && 'text-danger',
                )}
              >
                {phase.label}
              </span>
            </button>
            {index < PHASES.length - 1 && (
              <span className={cn('w-6 h-0.5 mx-0.5 bg-text-muted', isCompleted && 'bg-success')} />
            )}
          </div>
        );
      })}
    </div>
  );
}
