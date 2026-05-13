import type { CanonicalTerminalEvent, TerminalEventRecord } from '@shipcode/shared';
import { ERROR_PATTERNS, formatClockTime, stripAnsi } from '@shipcode/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shipcode/ui';
import { Badge, Button, cn } from '@shipshitdev/ui';
import { ArrowDownToLine, Check, Copy, Loader2, Terminal, Wand2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const DEFAULT_VISIBLE_EVENT_LIMIT = 300;

const ERROR_LINE_RE = /(^|\s)(error|fatal|panic|exception|traceback|posix_spawnp failed)\b/i;
const EXIT_NONZERO_RE = /\bexit(?:ed)?[^\d]+(?:code\s*)?([1-9]\d*)\b/i;
const WARNING_LINE_RE = /(^|\s)(warn(?:ing)?|deprecat(?:ed|ion))\b/i;

type ConsoleSeverity = 'error' | 'warning' | 'info';

function classifyConsoleLine(content: string): ConsoleSeverity {
  if (ERROR_LINE_RE.test(content)) return 'error';
  if (EXIT_NONZERO_RE.test(content)) return 'error';
  if (WARNING_LINE_RE.test(content)) return 'warning';
  return 'info';
}

type ToolCategory = 'bash' | 'file' | 'search' | 'default';

function toolCategory(name: string): ToolCategory {
  if (name === 'Bash') return 'bash';
  if (name === 'Read' || name === 'Write' || name === 'Edit') return 'file';
  if (name === 'Glob' || name === 'Grep') return 'search';
  return 'default';
}

const TOOL_BADGE_CLASSES: Record<ToolCategory, string> = {
  bash: 'border border-sky-500/25 bg-sky-500/15 text-sky-400',
  file: 'border border-emerald-500/25 bg-emerald-500/15 text-emerald-400',
  search: 'border border-violet-500/25 bg-violet-500/15 text-violet-400',
  default: 'border border-border/50 bg-secondary/60 text-muted-foreground',
};

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
              'mt-1.5 whitespace-pre-wrap break-words font-sans italic text-secondary/80',
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
              'mt-2 whitespace-pre-wrap break-words font-sans text-primary',
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
              'mt-2 whitespace-pre-wrap break-words font-sans text-danger',
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

function dedupeTranscriptEvents(events: TerminalEventRecord[]): TerminalEventRecord[] {
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const event of events) {
    if (seen.has(event.id)) {
      hasDuplicate = true;
      break;
    }
    seen.add(event.id);
  }
  if (!hasDuplicate) return events;
  return Array.from(new Map(events.map((record) => [record.id, record])).values());
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
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const dedupedEvents = useMemo(() => dedupeTranscriptEvents(events), [events]);

  const hasEvents = dedupedEvents.length > 0;
  const sourceKey = hasEvents
    ? `${dedupedEvents[0]?.threadId ?? ''}:${dedupedEvents[0]?.id ?? ''}`
    : 'empty';
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

  const plainRows = useMemo(
    () =>
      visibleEvents.map((record) => (
        <Fragment key={record.id}>
          {transcriptRow({
            record,
            compact,
            onAction,
            onAutoFix,
            onSendToTerminal,
            onCopyFailure: handleCopyFailure,
            autoFixingEventId,
            sendingToTerminalEventId,
            copiedEventId,
          })}
        </Fragment>
      )),
    [
      autoFixingEventId,
      compact,
      copiedEventId,
      handleCopyFailure,
      onAction,
      onAutoFix,
      onSendToTerminal,
      sendingToTerminalEventId,
      visibleEvents,
    ],
  );

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  useEffect(() => {
    void sourceKey;
    setShowAllEvents(false);
  }, [sourceKey]);

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
    const node = scrollRef.current!;
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
    <div className={cn('relative h-full', className)}>
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
