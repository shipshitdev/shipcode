import type { CanonicalTerminalEvent, TerminalEventRecord } from '@shipcode/shared';
import { ERROR_PATTERNS } from '@shipcode/shared';
import { Badge, Button, cn } from '@shipcode/ui';
import { useEffect, useMemo, useRef } from 'react';

interface TerminalTranscriptProps {
  events: TerminalEventRecord[];
  pendingLabel?: string | null;
  emptyMessage?: string;
  compact?: boolean;
  className?: string;
  onAction?: (event: Extract<CanonicalTerminalEvent, { kind: 'action' }>) => void;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI formatting from persisted terminal lines
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '');
}

function formatClock(isoLike: string): string {
  return new Date(isoLike).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTokens(usage: { prompt: number; completion: number } | undefined, costUsd?: number) {
  const parts: string[] = [];
  if (usage) parts.push(`${usage.prompt}+${usage.completion} tok`);
  if (typeof costUsd === 'number' && costUsd > 0) parts.push(`$${costUsd.toFixed(4)}`);
  return parts.join(' · ');
}

function TranscriptMeta({
  createdAt,
  compact = false,
  children,
}: {
  createdAt: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted',
        compact && 'text-[9px]',
      )}
    >
      <span>{formatClock(createdAt)}</span>
      {children}
    </div>
  );
}

function TranscriptRow({
  record,
  compact = false,
  onAction,
}: {
  record: TerminalEventRecord;
  compact?: boolean;
  onAction?: (event: Extract<CanonicalTerminalEvent, { kind: 'action' }>) => void;
}) {
  const event = record.event;

  switch (event.kind) {
    case 'action':
      return (
        <div className="flex items-center gap-2">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <Badge variant="default" className="rounded-full px-2 py-0 text-[9px] tracking-normal">
              Ready
            </Badge>
          </TranscriptMeta>
          {onAction ? (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 px-2 text-[11px] text-secondary hover:text-primary"
              onClick={() => onAction(event)}
            >
              {event.label}
            </Button>
          ) : (
            <span className="text-[12px] text-secondary">{event.label}</span>
          )}
        </div>
      );
    case 'lifecycle':
      return (
        <div className="rounded-lg border border-border/70 bg-primary/40 px-3 py-2">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-secondary normal-case">
              {stripAnsi(event.message)}
            </span>
          </TranscriptMeta>
        </div>
      );
    case 'turn_start':
      return (
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border/70" />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Turn {event.turn}
          </span>
          <div className="h-px flex-1 bg-border/70" />
        </div>
      );
    case 'turn_end': {
      const summary = formatTokens(event.tokensUsed, event.costUsd);
      if (!summary) return null;
      return (
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/60 px-3 py-2">
          <TranscriptMeta createdAt={record.createdAt} compact={compact} />
          <span className="font-mono text-[11px] text-secondary">{summary}</span>
        </div>
      );
    }
    case 'tool_start':
      return (
        <div className="rounded-lg border border-border/70 bg-secondary/80 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <TranscriptMeta createdAt={record.createdAt} compact={compact}>
              <Badge
                variant="default"
                className="rounded-full px-2 py-0 text-[9px] tracking-normal"
              >
                Tool
              </Badge>
            </TranscriptMeta>
            <span className="font-mono text-[11px] text-muted">{event.name}</span>
          </div>
          <div
            className={cn(
              'mt-2 break-words font-mono text-secondary',
              compact ? 'text-[11px]' : 'text-[12px]',
            )}
          >
            {stripAnsi(event.summary)}
          </div>
        </div>
      );
    case 'tool_end': {
      const failed = typeof event.exitCode === 'number' && event.exitCode !== 0;
      const detail = failed
        ? `Exit ${event.exitCode}`
        : typeof event.durationMs === 'number'
          ? `${(event.durationMs / 1000).toFixed(1)}s`
          : 'Completed';
      return (
        <div
          className={cn(
            'flex items-center justify-between rounded-lg border px-3 py-2',
            failed ? 'border-danger/30 bg-danger/8' : 'border-border/60 bg-secondary/60',
          )}
        >
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className={cn('tracking-normal normal-case', failed && 'text-danger')}>
              {failed ? 'Tool failed' : 'Tool finished'}
            </span>
          </TranscriptMeta>
          <span className={cn('font-mono text-[11px]', failed ? 'text-danger' : 'text-secondary')}>
            {detail}
          </span>
        </div>
      );
    }
    case 'thinking':
      return (
        <div className="rounded-xl border border-border/60 bg-secondary/60 px-4 py-3">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-secondary normal-case">Reasoning</span>
          </TranscriptMeta>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-sans italic text-secondary',
              compact ? 'text-[11px] leading-5' : 'text-[12px] leading-6',
            )}
          >
            {stripAnsi(event.content)}
          </pre>
        </div>
      );
    case 'text':
      return (
        <div className="rounded-xl border border-border/70 bg-elevated px-4 py-3 shadow-[0_1px_0_0_rgba(0,0,0,0.18)]">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-secondary normal-case">Assistant</span>
          </TranscriptMeta>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-sans text-primary',
              compact ? 'text-[12px] leading-5' : 'text-[13px] leading-6',
            )}
          >
            {stripAnsi(event.content)}
          </pre>
        </div>
      );
    case 'raw': {
      const content = stripAnsi(event.content);
      const isRateLimited = ERROR_PATTERNS.some(
        ({ pattern, type }) => type === 'rate_limited' && pattern.test(content),
      );
      return (
        <div
          className={cn(
            'rounded-xl border px-4 py-3',
            isRateLimited ? 'border-danger/30 bg-danger/8' : 'border-border/60 bg-secondary/60',
          )}
        >
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span
              className={cn(
                'tracking-normal normal-case',
                isRateLimited ? 'text-danger' : 'text-secondary',
              )}
            >
              Console
            </span>
          </TranscriptMeta>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-mono',
              compact ? 'text-[10px] leading-4' : 'text-[11px] leading-5',
              isRateLimited ? 'text-danger' : 'text-secondary',
            )}
          >
            {content}
          </pre>
        </div>
      );
    }
    case 'error':
      return (
        <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-danger normal-case">Error</span>
          </TranscriptMeta>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-sans text-danger',
              compact ? 'text-[12px] leading-5' : 'text-[13px] leading-6',
            )}
          >
            {stripAnsi(event.message)}
          </pre>
        </div>
      );
    case 'clarification_requested':
      return (
        <div className="rounded-xl border border-warning/35 bg-warning/[0.06] px-4 py-3">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <Badge variant="warning" className="rounded-full px-2 py-0 text-[9px] tracking-normal">
              Clarification
            </Badge>
          </TranscriptMeta>
          <div
            className={cn('mt-2 font-medium text-warning', compact ? 'text-[12px]' : 'text-[13px]')}
          >
            {event.summary}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-secondary">
            {event.questionCount} question{event.questionCount === 1 ? '' : 's'} waiting in the
            issue detail panel.
          </p>
        </div>
      );
    case 'clarification_answered':
      return (
        <div className="flex items-center justify-between rounded-lg border border-agent/25 bg-agent/[0.06] px-3 py-2">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-agent normal-case">Clarification answered</span>
          </TranscriptMeta>
          <span className="text-[11px] text-secondary">
            {event.questionCount} response{event.questionCount === 1 ? '' : 's'}
          </span>
        </div>
      );
    case 'done': {
      const summary = formatTokens(event.totalTokens, event.totalCostUsd);
      return (
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-primary/35 px-3 py-2">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-secondary normal-case">Done</span>
          </TranscriptMeta>
          {summary ? <span className="font-mono text-[11px] text-secondary">{summary}</span> : null}
        </div>
      );
    }
    default:
      return null;
  }
}

export function TerminalTranscript({
  events,
  pendingLabel = null,
  emptyMessage = 'No console output yet.',
  compact = false,
  className,
  onAction,
}: TerminalTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const hasEvents = events.length > 0;
  const scrollAnchor = hasEvents ? (events.at(-1)?.id ?? String(events.length)) : pendingLabel;
  const rows = useMemo(
    () =>
      events
        .map((record) => (
          <TranscriptRow key={record.id} record={record} compact={compact} onAction={onAction} />
        ))
        .filter(Boolean),
    [compact, events, onAction],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickToBottomRef.current || !scrollAnchor) return;
    node.scrollTop = node.scrollHeight;
  }, [scrollAnchor]);

  return (
    <div
      ref={scrollRef}
      className={cn('h-full overflow-y-auto overscroll-contain', className)}
      onScroll={(event) => {
        const node = event.currentTarget;
        stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      <div
        className={cn(
          'mx-auto flex min-h-full w-full flex-col gap-3 p-4',
          compact ? 'max-w-none p-3' : 'max-w-5xl',
        )}
      >
        {hasEvents ? rows : null}

        {!hasEvents && pendingLabel ? (
          <div className="flex min-h-full items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-elevated px-4 py-3">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-agent" />
              <span className={cn('text-secondary', compact ? 'text-[12px]' : 'text-[13px]')}>
                {pendingLabel}…
              </span>
            </div>
          </div>
        ) : null}

        {!hasEvents && !pendingLabel ? (
          <div className="flex min-h-full items-center justify-center">
            <div className="rounded-xl border border-dashed border-border/80 bg-primary/20 px-4 py-3 text-[12px] text-muted">
              {emptyMessage}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
