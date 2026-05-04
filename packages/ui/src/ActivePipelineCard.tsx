'use client';

import type { KeyboardEvent } from 'react';
import { modelDisplay } from '@/lib/model-display';
import { useSharedSecondNow } from '@/lib/second-ticker';
import {
  AGENT_RUNNING_PHASES,
  type ExecutorModel,
  PIPELINE_PHASE,
  type PipelinePhase,
  phaseToProgress,
} from '@/lib/shipcode';
import { formatElapsedDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PhaseChip } from '@/PhaseChip';
import { Badge } from '@/primitives/badge';
import { Button } from '@/primitives/button';

function PhaseElapsed({ since }: { since: number }) {
  const now = useSharedSecondNow();
  const label = formatElapsedDuration(since, now);

  return <span className="font-mono tabular-nums text-[10px] text-muted">{label}</span>;
}

export interface ActivePipelineCardProps {
  projectName: string;
  title: string;
  phase: PipelinePhase;
  approvedAwaitingExecution?: boolean;
  startedAt: number;
  issueNumber?: number | null;
  modelProvider?: ExecutorModel | null;
  model?: string | null;
  reasoningEffort?: string | null;
  onClick: () => void;
  onCancel?: () => void;
  className?: string;
}

export function ActivePipelineCard({
  projectName,
  title,
  phase,
  approvedAwaitingExecution = false,
  startedAt,
  issueNumber = null,
  model = null,
  reasoningEffort = null,
  onClick,
  onCancel,
  className,
}: ActivePipelineCardProps) {
  const isHumanBlocked =
    phase === PIPELINE_PHASE.clarifying ||
    (phase === PIPELINE_PHASE.awaitingApproval && !approvedAwaitingExecution);
  const isAgentActive = AGENT_RUNNING_PHASES.includes(phase);
  const progress = phaseToProgress(phase);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: the card is clickable but also contains nested action buttons, so a semantic button wrapper would be invalid HTML
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${title}`}
      className={cn(
        'group relative flex min-h-[92px] w-full flex-col overflow-hidden rounded-md border bg-elevated p-3 text-left transition-colors outline-none',
        isHumanBlocked
          ? 'border-warning/30 bg-warning/[0.03] hover:border-warning/50'
          : 'border-agent/40 bg-agent/[0.03] shadow-[0_0_12px_rgba(56,189,248,0.18)] hover:border-agent/60',
        className,
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {isAgentActive && (
        <div
          aria-hidden="true"
          className="issue-card-active-bg pointer-events-none absolute inset-0 rounded-[inherit]"
        >
          <span className="absolute inset-0 bg-gradient-to-br from-agent/[0.05] via-agent/[0.02] to-transparent" />
          <span className="absolute inset-0 animate-slide-progress-card bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
        </div>
      )}

      <div
        className={cn(
          'absolute right-0 bottom-0 left-0 z-10 h-[3px] overflow-hidden rounded-b-md',
          isHumanBlocked ? 'bg-warning/15' : 'bg-agent/15',
        )}
      >
        <div
          className={cn(
            'absolute h-full transition-[width] duration-700',
            isHumanBlocked ? 'bg-warning' : 'bg-agent',
          )}
          style={{ width: `${progress}%` }}
        />
        {isAgentActive && (
          <span className="absolute inset-0 animate-slide-progress bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] text-muted">{projectName}</span>
          {issueNumber != null && (
            <span className="shrink-0 font-mono text-[11px] text-secondary">#{issueNumber}</span>
          )}
        </div>
        <span className="flex items-center gap-1.5">
          <span className="font-mono tabular-nums text-[10px] text-muted">{progress}%</span>
          <PhaseElapsed since={startedAt} />
        </span>
      </div>

      <div className="relative z-10 mt-1 w-full min-w-0">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-primary">
          {title}
        </span>
      </div>

      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-1.5 pt-2">
        {model && (
          <Badge
            variant="default"
            className="px-1.5 py-px text-[10px] font-medium normal-case tracking-normal"
            title={`Active model: ${modelDisplay(model)}${reasoningEffort ? ` · ${reasoningEffort}` : ''}`}
          >
            {modelDisplay(model)}
            {reasoningEffort ? ` · ${reasoningEffort}` : ''}
          </Badge>
        )}

        {onCancel ? (
          <span className="relative inline-flex items-center">
            <span className="pointer-events-none transition-opacity group-hover:opacity-0">
              <PhaseChip
                status={phase}
                label={approvedAwaitingExecution ? 'Waiting for slot' : undefined}
                className={cn(
                  approvedAwaitingExecution && 'border-agent/25 bg-agent/10 text-agent',
                )}
              />
            </span>
            <Button
              variant="ghost"
              size="xs"
              className={cn(
                'absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100',
                isHumanBlocked
                  ? 'text-warning/70 hover:bg-warning/10 hover:text-warning'
                  : 'text-danger/70 hover:bg-danger/10 hover:text-danger',
              )}
              title="Cancel pipeline"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCancel();
              }}
            >
              CANCEL
            </Button>
          </span>
        ) : (
          <PhaseChip
            status={phase}
            label={approvedAwaitingExecution ? 'Waiting for slot' : undefined}
            className={cn(approvedAwaitingExecution && 'border-agent/25 bg-agent/10 text-agent')}
          />
        )}
      </div>
    </div>
  );
}
