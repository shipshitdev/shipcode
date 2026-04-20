'use client';

import { type ExecutorModel, type PipelinePhase, phaseToProgress } from '@shipcode/shared';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { formatProviderModelDisplay } from './lib/model-display';
import { cn } from './lib/utils';
import { PhaseChip } from './PhaseChip';
import { Badge } from './primitives/badge';
import { Button } from './primitives/button';

const AGENT_ACTIVE_PHASES = new Set<PipelinePhase>([
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
]);

function formatElapsed(since: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function PhaseElapsed({ since }: { since: number }) {
  const [label, setLabel] = useState(() => formatElapsed(since));

  useEffect(() => {
    setLabel(formatElapsed(since));
    const id = setInterval(() => setLabel(formatElapsed(since)), 1000);
    return () => clearInterval(id);
  }, [since]);

  return <span className="font-mono tabular-nums text-[10px] text-muted">{label}</span>;
}

export interface ActivePipelineCardProps {
  projectName: string;
  title: string;
  phase: PipelinePhase;
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
  startedAt,
  issueNumber = null,
  modelProvider = null,
  model = null,
  reasoningEffort = null,
  onClick,
  onCancel,
  className,
}: ActivePipelineCardProps) {
  const isAwaiting = phase === 'awaiting_approval';
  const isAgentActive = AGENT_ACTIVE_PHASES.has(phase);
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
        isAwaiting
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
          isAwaiting ? 'bg-warning/15' : 'bg-agent/15',
        )}
      >
        <div
          className={cn(
            'absolute h-full transition-[width] duration-700',
            isAwaiting ? 'bg-warning' : 'bg-agent',
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

      <div className="relative z-10 mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-primary">
        {title}
      </div>

      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-1.5 pt-2">
        {modelProvider && model && (
          <Badge
            variant="default"
            className="px-1.5 py-px text-[10px] font-medium normal-case tracking-normal"
            title={`Active model ${model}${reasoningEffort ? ` (${reasoningEffort})` : ''}`}
          >
            {formatProviderModelDisplay(modelProvider, model)}
            {reasoningEffort ? ` · ${reasoningEffort}` : ''}
          </Badge>
        )}

        {onCancel ? (
          <span className="relative inline-flex items-center">
            <span className="pointer-events-none transition-opacity group-hover:opacity-0">
              <PhaseChip status={phase} />
            </span>
            <Button
              variant="ghost"
              size="xs"
              className={cn(
                'absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100',
                isAwaiting
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
          <PhaseChip status={phase} />
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            className={cn(
              'h-5 px-1.5 text-[10px] font-medium opacity-0 transition-all group-hover:opacity-100',
              isAwaiting
                ? 'text-warning/60 hover:bg-warning/10 hover:text-warning'
                : 'text-agent/60 hover:bg-agent/10 hover:text-agent',
            )}
            title="Open issue detail"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            View
          </Button>
        </div>
      </div>
    </div>
  );
}
