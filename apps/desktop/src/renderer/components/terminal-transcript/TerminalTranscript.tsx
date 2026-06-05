import type { CanonicalTerminalEvent, TerminalEventRecord } from '@shipcode/shared';
import { ERROR_PATTERNS, formatClockTime, stripAnsi } from '@shipcode/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shipcode/ui';
import { Badge, Button, cn } from '@shipshitdev/ui';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Info,
  Loader2,
  Search,
  SquarePen,
  Terminal,
  Wand2,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ConsoleSeverity,
  classifyConsoleLine,
  consolidateToolPairs,
  DEFAULT_VISIBLE_EVENT_LIMIT,
  DEFAULT_WORKLOG_VISIBLE,
  dedupeTranscriptEvents,
  formatTokens,
  groupTranscriptEvents,
  TOOL_BADGE_CLASSES,
  toolCategory,
  workLogRowDetail,
  workLogRowLabel,
} from './transcript-events';

export interface TerminalFailureActionRequest {
  record: TerminalEventRecord;
  output: string;
}

export type TerminalAutoFixRequest = TerminalFailureActionRequest;

interface TerminalTranscriptProps {
  events: TerminalEventRecord[];
  pendingLabel?: string | null;
  emptyMessage?: string;
  compact?: boolean;
  className?: string;
  onAction?: (event: Extract<CanonicalTerminalEvent, { kind: 'action' }>) => void;
  onAutoFix?: (request: TerminalFailureActionRequest) => void;
  onSendToTerminal?: (request: TerminalFailureActionRequest) => void;
  autoFixingEventId?: string | null;
  sendingToTerminalEventId?: string | null;
}

function clearStoredTimeout(ref: { current: ReturnType<typeof setTimeout> | null }) {
  const timeout = ref.current;
  if (timeout) clearTimeout(timeout);
}

function toolStartIcon(name: string) {
  const cat = toolCategory(name);
  if (cat === 'bash') return <Terminal size={14} className="text-sky-400/70" />;
  if (cat === 'file') return <SquarePen size={14} className="text-emerald-400/70" />;
  if (cat === 'search') return <Search size={14} className="text-violet-400/70" />;
  return <Wrench size={14} className="text-muted-foreground/60" />;
}

function workLogRowIcon(record: TerminalEventRecord, completed = false) {
  const e = record.event;
  if (e.kind === 'tool_start') {
    if (completed) return <Check size={14} className="text-emerald-400/70" />;
    return toolStartIcon(e.name);
  }
  if (e.kind === 'tool_end') return <Check size={14} className="text-emerald-400/70" />;
  if (e.kind === 'lifecycle') return <Info size={14} className="text-muted-foreground/50" />;
  return <Terminal size={14} className="text-muted-foreground/50" />;
}

function WorkLogRow({
  record,
  compact,
  completed = false,
}: {
  record: TerminalEventRecord;
  compact: boolean;
  completed?: boolean;
}) {
  const detail = workLogRowDetail(record);
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <span className="flex size-5 shrink-0 items-center justify-center">
        {workLogRowIcon(record, completed)}
      </span>
      <span
        className={cn('min-w-0 flex-1 truncate font-mono', compact ? 'text-[11px]' : 'text-[12px]')}
      >
        <span className="text-muted-foreground/90">{workLogRowLabel(record)}</span>
        {detail && <span className="text-muted-foreground/50"> &ndash; {detail}</span>}
      </span>
    </div>
  );
}

function WorkLogCard({ records, compact }: { records: TerminalEventRecord[]; compact: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const items = useMemo(() => consolidateToolPairs(records), [records]);
  const hiddenCount =
    !isExpanded && items.length > DEFAULT_WORKLOG_VISIBLE
      ? items.length - DEFAULT_WORKLOG_VISIBLE
      : 0;
  const visibleItems =
    isExpanded || items.length <= DEFAULT_WORKLOG_VISIBLE
      ? items
      : items.slice(-DEFAULT_WORKLOG_VISIBLE);

  return (
    <div className="mb-3 rounded-xl border border-border/45 bg-secondary/20 px-2 py-1.5">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Work log ({items.length})
        </span>
        {hiddenCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-auto rounded-none p-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/80"
            onClick={() => setIsExpanded(true)}
          >
            Show {hiddenCount} more
            <ChevronDown size={10} />
          </Button>
        )}
        {isExpanded && items.length > DEFAULT_WORKLOG_VISIBLE && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-auto rounded-none p-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/80"
            onClick={() => setIsExpanded(false)}
          >
            Show less
            <ChevronUp size={10} />
          </Button>
        )}
      </div>
      <div className="space-y-0.5">
        {visibleItems.map((item) =>
          item.type === 'pair' ? (
            <div key={item.start.id} data-testid={`terminal-event-${item.start.event.kind}`}>
              <WorkLogRow record={item.start} compact={compact} completed />
            </div>
          ) : (
            <div key={item.record.id} data-testid={`terminal-event-${item.record.event.kind}`}>
              <WorkLogRow record={item.record} compact={compact} />
            </div>
          ),
        )}
      </div>
    </div>
  );
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
        'flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground',
        compact && 'text-[9px]',
      )}
    >
      <span>{formatClockTime(createdAt)}</span>
      {children}
    </div>
  );
}

function FailureActions({
  record,
  output,
  compact = false,
  onAutoFix,
  onSendToTerminal,
  onCopy,
  autoFixingEventId,
  sendingToTerminalEventId,
  copiedEventId,
}: {
  record: TerminalEventRecord;
  output: string;
  compact?: boolean;
  onAutoFix?: (request: TerminalFailureActionRequest) => void;
  onSendToTerminal?: (request: TerminalFailureActionRequest) => void;
  onCopy?: (request: TerminalFailureActionRequest) => void;
  autoFixingEventId?: string | null;
  sendingToTerminalEventId?: string | null;
  copiedEventId?: string | null;
}) {
  if (output.trim().length === 0) return null;

  const autoFixing = autoFixingEventId === record.id;
  const sending = sendingToTerminalEventId === record.id;
  const copied = copiedEventId === record.id;
  const buttonClass = cn(
    'border-border/70 bg-primary/30 text-secondary hover:text-primary',
    compact ? 'h-5 w-5' : 'h-6 w-6',
  );

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {onCopy ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={copied ? 'Copied failure output' : 'Copy failure output'}
              className={buttonClass}
              onClick={() => onCopy({ record, output })}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{copied ? 'Copied' : 'Copy error'}</TooltipContent>
        </Tooltip>
      ) : null}
      {onSendToTerminal ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Send failure to terminal"
              className={cn(
                'border-agent/35 bg-agent/10 text-agent hover:bg-agent/15 hover:text-agent',
                compact ? 'h-5 w-5' : 'h-6 w-6',
              )}
              disabled={sending}
              onClick={() => onSendToTerminal({ record, output })}
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Send to terminal</TooltipContent>
        </Tooltip>
      ) : null}
      {onAutoFix ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Auto fix failure"
              className={cn(
                'border-danger/35 bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger',
                compact ? 'h-5 w-5' : 'h-6 w-6',
              )}
              disabled={autoFixing}
              onClick={() => onAutoFix({ record, output })}
            >
              {autoFixing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Auto Fix</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function transcriptRow({
  record,
  compact = false,
  onAction,
  onAutoFix,
  onSendToTerminal,
  onCopyFailure,
  autoFixingEventId,
  sendingToTerminalEventId,
  copiedEventId,
}: {
  record: TerminalEventRecord;
  compact?: boolean;
  onAction?: (event: Extract<CanonicalTerminalEvent, { kind: 'action' }>) => void;
  onAutoFix?: (request: TerminalFailureActionRequest) => void;
  onSendToTerminal?: (request: TerminalFailureActionRequest) => void;
  onCopyFailure?: (request: TerminalFailureActionRequest) => void;
  autoFixingEventId?: string | null;
  sendingToTerminalEventId?: string | null;
  copiedEventId?: string | null;
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
    case 'lifecycle': {
      const lifecycleText = stripAnsi(event.message);
      const lifecycleSeverity = classifyConsoleLine(lifecycleText);
      if (lifecycleSeverity === 'info') {
        return (
          <div className="flex items-start gap-2 rounded-md border border-border/30 bg-secondary/20 px-3 py-1.5">
            <TranscriptMeta createdAt={record.createdAt} compact={compact} />
            <pre
              className={cn(
                'flex-1 whitespace-pre-wrap break-words font-mono text-secondary/70',
                compact ? 'text-[10px] leading-4' : 'text-[11px] leading-[1.5]',
              )}
            >
              {lifecycleText}
            </pre>
          </div>
        );
      }
      return (
        <div
          className={cn(
            'mb-3 rounded-lg border px-3 py-2',
            lifecycleSeverity === 'error'
              ? 'border-danger/30 bg-danger/8'
              : 'border-warning/30 bg-warning/8',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <TranscriptMeta createdAt={record.createdAt} compact={compact}>
              <span
                className={cn(
                  'tracking-normal normal-case',
                  lifecycleSeverity === 'error' ? 'text-danger' : 'text-warning',
                )}
              >
                {lifecycleText}
              </span>
            </TranscriptMeta>
            <FailureActions
              record={record}
              output={lifecycleText}
              compact={compact}
              onAutoFix={onAutoFix}
              onSendToTerminal={onSendToTerminal}
              onCopy={onCopyFailure}
              autoFixingEventId={autoFixingEventId}
              sendingToTerminalEventId={sendingToTerminalEventId}
              copiedEventId={copiedEventId}
            />
          </div>
        </div>
      );
    }
    case 'turn_start':
      return (
        <div className="flex items-center gap-3 py-2">
          <div className="h-px flex-1 bg-border/50" />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Turn {event.turn}
          </span>
          <div className="h-px flex-1 bg-border/50" />
        </div>
      );
    case 'user_input': {
      const textContent = stripAnsi(event.content);
      return (
        <div className="group/msg mb-3 rounded-lg border border-agent/35 bg-agent/10 px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.16)]">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-agent normal-case font-medium">User</span>
          </TranscriptMeta>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-mono text-primary',
              compact ? 'text-[12px] leading-[1.6]' : 'text-[13px] leading-[1.65]',
            )}
          >
            {textContent}
          </pre>
        </div>
      );
    }
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
    case 'tool_start': {
      const cat = toolCategory(event.name);
      const displayText = event.command
        ? `$ ${event.command}`
        : event.filePath && event.pattern
          ? `"${event.pattern}" in ${event.filePath}`
          : (event.filePath ?? event.pattern ?? stripAnsi(event.summary));
      return (
        <div className="mb-3 rounded-md border border-border/40 bg-secondary/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="default"
              className={cn(
                'shrink-0 rounded-sm px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide',
                TOOL_BADGE_CLASSES[cat],
              )}
            >
              {event.name || 'TOOL'}
            </Badge>
            <TranscriptMeta createdAt={record.createdAt} compact={compact} />
          </div>
          <pre
            className={cn(
              'mt-1.5 whitespace-pre-wrap break-words font-mono',
              cat === 'bash' ? 'text-primary/90' : 'text-primary/75',
              compact ? 'text-[11px] leading-4' : 'text-[12px] leading-[1.55]',
            )}
          >
            {displayText}
          </pre>
        </div>
      );
    }
    case 'tool_end': {
      const failed = typeof event.exitCode === 'number' && event.exitCode !== 0;
      const outputSummary = failed ? event.outputSummary?.trim() : undefined;
      const detail = failed
        ? `Exit ${event.exitCode}`
        : typeof event.durationMs === 'number'
          ? `${(event.durationMs / 1000).toFixed(1)}s`
          : 'Completed';
      if (!failed) return null;
      return (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/8 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <TranscriptMeta createdAt={record.createdAt} compact={compact}>
              <span className="tracking-normal normal-case text-danger">Tool failed</span>
            </TranscriptMeta>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-danger">{detail}</span>
              <FailureActions
                record={record}
                output={outputSummary ?? detail}
                compact={compact}
                onAutoFix={onAutoFix}
                onSendToTerminal={onSendToTerminal}
                onCopy={onCopyFailure}
                autoFixingEventId={autoFixingEventId}
                sendingToTerminalEventId={sendingToTerminalEventId}
                copiedEventId={copiedEventId}
              />
            </div>
          </div>
          {outputSummary ? (
            <pre
              className={cn(
                'mt-2 whitespace-pre-wrap break-words font-mono text-danger',
                compact ? 'text-[10px] leading-4' : 'text-[11px] leading-5',
              )}
            >
              {outputSummary}
            </pre>
          ) : null}
        </div>
      );
    }
    case 'thinking':
      return (
        <div className="mb-3 rounded-md border border-border/50 bg-secondary/40 px-3 py-2.5">
          <TranscriptMeta createdAt={record.createdAt} compact={compact}>
            <span className="tracking-normal text-muted-foreground/80 normal-case">Reasoning</span>
          </TranscriptMeta>
          <pre
            className={cn(
              'mt-1.5 whitespace-pre-wrap break-words font-mono italic text-secondary/80',
              compact ? 'text-[11px] leading-5' : 'text-[12px] leading-[1.6]',
            )}
          >
            {stripAnsi(event.content)}
          </pre>
        </div>
      );
    case 'text': {
      const textContent = stripAnsi(event.content);
      const isTextCopied = copiedEventId === record.id;
      return (
        <div className="group/msg mb-3 rounded-lg border border-border/60 bg-elevated px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
          <div className="flex items-start justify-between gap-3">
            <TranscriptMeta createdAt={record.createdAt} compact={compact}>
              <span className="tracking-normal text-primary/70 normal-case font-medium">
                Assistant
              </span>
            </TranscriptMeta>
            {onCopyFailure ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={isTextCopied ? 'Copied' : 'Copy message'}
                    className={cn(
                      'h-6 w-6 shrink-0 transition-colors',
                      isTextCopied
                        ? 'text-foreground'
                        : 'text-muted-foreground opacity-0 group-hover/msg:opacity-100 hover:text-foreground',
                    )}
                    onClick={() => onCopyFailure({ record, output: textContent })}
                  >
                    {isTextCopied ? <Check size={12} /> : <Copy size={12} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isTextCopied ? 'Copied' : 'Copy message'}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-mono text-primary',
              compact ? 'text-[12px] leading-[1.6]' : 'text-[13px] leading-[1.65]',
            )}
          >
            {textContent}
          </pre>
        </div>
      );
    }
    case 'raw': {
      const content = stripAnsi(event.content);
      const isRateLimited = ERROR_PATTERNS.some(
        ({ pattern, type }) => type === 'rate_limited' && pattern.test(content),
      );
      const severity: ConsoleSeverity = isRateLimited ? 'error' : classifyConsoleLine(content);
      if (severity === 'info') {
        return (
          <div className="flex items-start gap-2 px-1">
            <TranscriptMeta createdAt={record.createdAt} compact={compact} />
            <pre
              className={cn(
                'flex-1 whitespace-pre-wrap break-words font-mono text-muted-foreground/70',
                compact ? 'text-[10px] leading-4' : 'text-[11px] leading-[1.5]',
              )}
            >
              {content}
            </pre>
          </div>
        );
      }
      return (
        <div
          className={cn(
            'mb-3 rounded-md border px-3 py-2.5',
            severity === 'error'
              ? 'border-danger/30 bg-danger/8'
              : 'border-warning/30 bg-warning/8',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <TranscriptMeta createdAt={record.createdAt} compact={compact}>
              <span
                className={cn(
                  'tracking-normal normal-case',
                  severity === 'error' ? 'text-danger' : 'text-warning',
                )}
              >
                Console
              </span>
            </TranscriptMeta>
            <FailureActions
              record={record}
              output={content}
              compact={compact}
              onAutoFix={onAutoFix}
              onSendToTerminal={onSendToTerminal}
              onCopy={onCopyFailure}
              autoFixingEventId={autoFixingEventId}
              sendingToTerminalEventId={sendingToTerminalEventId}
              copiedEventId={copiedEventId}
            />
          </div>
          <pre
            className={cn(
              'mt-1.5 whitespace-pre-wrap break-words font-mono',
              compact ? 'text-[10px] leading-4' : 'text-[11px] leading-[1.5]',
              severity === 'error' ? 'text-danger' : 'text-warning',
            )}
          >
            {content}
          </pre>
        </div>
      );
    }
    case 'error': {
      const errorMessage = stripAnsi(event.message);
      return (
        <div className="mb-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <TranscriptMeta createdAt={record.createdAt} compact={compact}>
              <span className="tracking-normal text-danger normal-case">Error</span>
            </TranscriptMeta>
            <FailureActions
              record={record}
              output={errorMessage}
              compact={compact}
              onAutoFix={onAutoFix}
              onSendToTerminal={onSendToTerminal}
              onCopy={onCopyFailure}
              autoFixingEventId={autoFixingEventId}
              sendingToTerminalEventId={sendingToTerminalEventId}
              copiedEventId={copiedEventId}
            />
          </div>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words font-mono text-danger',
              compact ? 'text-[12px] leading-5' : 'text-[13px] leading-6',
            )}
          >
            {errorMessage}
          </pre>
        </div>
      );
    }
    case 'clarification_requested':
      return (
        <div className="mb-3 rounded-xl border border-warning/35 bg-warning/[0.06] px-4 py-3">
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
  onAutoFix,
  onSendToTerminal,
  autoFixingEventId = null,
  sendingToTerminalEventId = null,
}: TerminalTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showAllEventsState, setShowAllEventsState] = useState({
    sourceKey: 'empty',
    value: false,
  });
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const dedupedEvents = useMemo(() => dedupeTranscriptEvents(events), [events]);

  const hasEvents = dedupedEvents.length > 0;
  const sourceKey = hasEvents
    ? `${dedupedEvents[0]?.threadId ?? ''}:${dedupedEvents[0]?.id ?? ''}`
    : 'empty';
  const showAllEvents =
    showAllEventsState.sourceKey === sourceKey ? showAllEventsState.value : false;
  if (showAllEventsState.sourceKey !== sourceKey) {
    setShowAllEventsState({ sourceKey, value: false });
  }
  const setShowAllEvents = useCallback(
    (value: boolean) => {
      setShowAllEventsState({ sourceKey, value });
    },
    [sourceKey],
  );
  const visibleEvents = useMemo(
    () =>
      showAllEvents || dedupedEvents.length <= DEFAULT_VISIBLE_EVENT_LIMIT
        ? dedupedEvents
        : dedupedEvents.slice(-DEFAULT_VISIBLE_EVENT_LIMIT),
    [dedupedEvents, showAllEvents],
  );
  const hiddenEventCount = dedupedEvents.length - visibleEvents.length;
  const scrollAnchor = hasEvents
    ? (visibleEvents.at(-1)?.id ?? String(visibleEvents.length))
    : pendingLabel;

  const handleCopyFailure = useCallback(
    async ({ record, output }: TerminalFailureActionRequest) => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      try {
        await navigator.clipboard.writeText(output);
        setCopiedEventId(record.id);
        copyResetRef.current = setTimeout(() => setCopiedEventId(null), 1500);
      } catch {
        setCopiedEventId(null);
      }
    },
    [],
  );

  const groupedSegments = useMemo(() => groupTranscriptEvents(visibleEvents), [visibleEvents]);

  const plainRows = useMemo(
    () =>
      groupedSegments.map((segment, idx) => {
        if (segment.type === 'worklog') {
          const key = segment.records[0]?.id ?? `wl-${idx}`;
          return <WorkLogCard key={key} records={segment.records} compact={compact} />;
        }
        return (
          <div key={segment.record.id} data-testid={`terminal-event-${segment.record.event.kind}`}>
            {transcriptRow({
              record: segment.record,
              compact,
              onAction,
              onAutoFix,
              onSendToTerminal,
              onCopyFailure: handleCopyFailure,
              autoFixingEventId,
              sendingToTerminalEventId,
              copiedEventId,
            })}
          </div>
        );
      }),
    [
      autoFixingEventId,
      compact,
      copiedEventId,
      groupedSegments,
      handleCopyFailure,
      onAction,
      onAutoFix,
      onSendToTerminal,
      sendingToTerminalEventId,
    ],
  );

  useEffect(() => {
    return () => {
      clearStoredTimeout(copyResetRef);
    };
  }, []);

  // Stick-to-bottom: scroll to end when new events arrive.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickToBottomRef.current || !scrollAnchor) return;
    node.scrollTop = node.scrollHeight;
  }, [scrollAnchor]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    stickToBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    stickToBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  const headerContent = (
    <>
      {hiddenEventCount > 0 ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="xs"
            className="rounded-full border border-border bg-primary/60 px-3 text-muted-foreground"
            onClick={() => setShowAllEvents(true)}
          >
            Show {hiddenEventCount} older event{hiddenEventCount === 1 ? '' : 's'}
          </Button>
        </div>
      ) : null}

      {showAllEvents && dedupedEvents.length > DEFAULT_VISIBLE_EVENT_LIMIT ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="xs"
            className="rounded-full border border-border bg-primary/60 px-3 text-muted-foreground"
            onClick={() => setShowAllEvents(false)}
          >
            Show latest {DEFAULT_VISIBLE_EVENT_LIMIT}
          </Button>
        </div>
      ) : null}
    </>
  );

  const footerContent = (
    <>
      {!hasEvents && pendingLabel ? (
        <div className="flex min-h-full items-center justify-center">
          <div className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-elevated px-4 py-3">
            <span className="size-2.5 animate-pulse rounded-full bg-agent" />
            <span className={cn('text-secondary', compact ? 'text-[12px]' : 'text-[13px]')}>
              {pendingLabel}…
            </span>
          </div>
        </div>
      ) : null}

      {!hasEvents && !pendingLabel ? (
        <div className="flex min-h-full items-center justify-center">
          <div className="rounded-xl border border-dashed border-border/80 bg-primary/20 px-4 py-3 text-[12px] text-muted-foreground">
            {emptyMessage}
          </div>
        </div>
      ) : null}
    </>
  );

  const scrollToBottomButton =
    hasEvents && !isAtBottom ? (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
        <Button
          variant="outline"
          size="xs"
          className="pointer-events-auto gap-1.5 rounded-full border-border bg-elevated px-3 shadow-md"
          onClick={scrollToBottom}
        >
          <ArrowDownToLine size={12} />
          <span className="text-[11px]">Scroll to bottom</span>
        </Button>
      </div>
    ) : null;

  return (
    <div className={cn('relative h-full', className)} data-testid="terminal-transcript">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={handleScroll}
      >
        <div className={cn('flex min-h-full w-full flex-col gap-1.5', compact ? 'p-3' : 'p-4')}>
          {headerContent}
          {hasEvents ? plainRows : null}
          {footerContent}
        </div>
      </div>
      {scrollToBottomButton}
    </div>
  );
}
