import { formatClockTime, stripAnsi, type TerminalEventRecord } from '@shipcode/shared';
import { CollapsibleSection } from '@shipcode/ui';
import { Badge, cn } from '@shipshitdev/ui';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../stores/app-store';

const EMPTY_STREAM: TerminalEventRecord[] = [];
const THINKING_LETTERS = [
  { id: 't', letter: 'T', delay: 0 },
  { id: 'h', letter: 'h', delay: 1 },
  { id: 'i', letter: 'i', delay: 2 },
  { id: 'n', letter: 'n', delay: 3 },
  { id: 'k', letter: 'k', delay: 4 },
  { id: 'i-2', letter: 'i', delay: 5 },
  { id: 'n-2', letter: 'n', delay: 6 },
  { id: 'g', letter: 'g', delay: 7 },
];

export interface AssistantTimelineUserMessage {
  id: string;
  threadId: string;
  content: string;
  createdAt: string;
}

type ConversationItem =
  | { id: string; kind: 'user'; content: string; createdAt: string }
  | { id: string; kind: 'assistant'; content: string; createdAt: string }
  | { id: string; kind: 'thinking'; content: string; createdAt: string }
  | { id: string; kind: 'activity'; content: string; createdAt: string }
  | {
      id: string;
      kind: 'tool';
      name: string;
      summary: string;
      durationMs?: number;
      exitCode?: number;
      outputSummary?: string;
      createdAt: string;
    }
  | { id: string; kind: 'error'; message: string; createdAt: string };

export function useAssistantTranscript(threadId: string | null) {
  const stream = useAppStore((state) =>
    threadId ? (state.canonicalTerminalStream[threadId] ?? EMPTY_STREAM) : EMPTY_STREAM,
  );
  const hydrateCanonicalEvents = useAppStore((state) => state.hydrateCanonicalEvents);

  useEffect(() => {
    if (!threadId || stream.length > 0) return;

    let cancelled = false;
    void window.shipcode
      .invoke<TerminalEventRecord[]>('terminal:list', { threadId, limit: 1000 })
      .then((events) => {
        if (cancelled || !Array.isArray(events) || events.length === 0) return;
        hydrateCanonicalEvents(threadId, events);
      })
      .catch(() => {
        // Best-effort transcript hydration.
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateCanonicalEvents, stream.length, threadId]);

  return stream;
}

function rawActivityLines(content: string): string[] {
  const lines: string[] = [];
  for (const raw of stripAnsi(content).replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (
      !line ||
      /^[\d:.\s]+$/.test(line) ||
      /^esc to cancel/i.test(line) ||
      /^ctrl[+-]/i.test(line)
    )
      continue;
    lines.push(line);
  }
  return lines.slice(-6);
}

export function buildConversationItems(records: TerminalEventRecord[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const pendingTools = new Map<string, ConversationItem & { kind: 'tool' }>();
  let previousRawLine: string | null = null;

  for (const record of records) {
    const { event, id, createdAt } = record;

    if (event.kind === 'text') {
      const content = stripAnsi(event.content).trim();
      if (content) items.push({ id, kind: 'assistant', content, createdAt });
    } else if (event.kind === 'thinking') {
      const content = stripAnsi(event.content).trim();
      if (content) items.push({ id, kind: 'thinking', content, createdAt });
    } else if (event.kind === 'tool_start') {
      const item: ConversationItem & { kind: 'tool' } = {
        id,
        kind: 'tool',
        name: event.name,
        summary: stripAnsi(event.summary).trim(),
        createdAt,
      };
      pendingTools.set(event.name, item);
      items.push(item);
    } else if (event.kind === 'tool_end') {
      const pending = pendingTools.get(event.name);
      if (pending) {
        Object.assign(pending, {
          durationMs: event.durationMs,
          exitCode: event.exitCode,
          outputSummary: event.outputSummary ? stripAnsi(event.outputSummary).trim() : undefined,
        });
        pendingTools.delete(event.name);
      }
    } else if (event.kind === 'error') {
      const message = stripAnsi(event.message).trim();
      if (message) items.push({ id, kind: 'error', message, createdAt });
    } else if (event.kind === 'raw') {
      const lines = rawActivityLines(event.content);
      for (const [index, line] of lines.entries()) {
        if (line === previousRawLine) continue;
        previousRawLine = line;
        items.push({
          id: `${id}:raw:${index}`,
          kind: 'activity',
          content: line,
          createdAt,
        });
      }
    }
  }

  return items;
}

function latestActivity(events: TerminalEventRecord[]) {
  let thinking: string | null = null;
  let activeTool: string | null = null;
  let completedTools = 0;
  let failedTools = 0;
  let errorCount = 0;

  for (const record of events) {
    const event = record.event;
    if (event.kind === 'thinking') {
      const content = stripAnsi(event.content).trim();
      if (content) thinking = content;
    }
    if (event.kind === 'tool_start') {
      activeTool = [event.name, stripAnsi(event.summary).trim()].filter(Boolean).join(' · ');
    }
    if (event.kind === 'tool_end') {
      completedTools += 1;
      if (typeof event.exitCode === 'number' && event.exitCode !== 0) {
        failedTools += 1;
      }
      activeTool = null;
    }
    if (event.kind === 'error') {
      errorCount += 1;
    }
  }

  return { thinking, activeTool, completedTools, failedTools, errorCount };
}

function AnimatedThinkingWord({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Thinking"
      className={cn('inline-flex font-medium text-[11px] tracking-wide uppercase', className)}
    >
      {THINKING_LETTERS.map(({ id, letter, delay }) => (
        <span
          key={id}
          aria-hidden="true"
          className="assistant-thinking-letter"
          style={{ '--thinking-letter-index': delay } as CSSProperties}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

function AgentActivityOverview({
  events,
  isRunning,
}: {
  events: TerminalEventRecord[];
  isRunning: boolean;
}) {
  const activity = useMemo(() => latestActivity(events), [events]);
  const hasActivity =
    activity.thinking != null ||
    activity.activeTool != null ||
    activity.completedTools > 0 ||
    activity.errorCount > 0;

  if (!hasActivity) return null;

  return (
    <div className="rounded-md border border-border/70 bg-primary/50 px-3 py-2 text-[11px] text-secondary">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isRunning ? 'default' : 'done'} className="text-[10px]">
          {isRunning ? 'Running' : 'Done'}
        </Badge>
        {activity.activeTool ? (
          <span className="truncate text-primary">Tool: {activity.activeTool}</span>
        ) : activity.completedTools > 0 ? (
          <span>
            Tools: {activity.completedTools}
            {activity.failedTools > 0 ? ` (${activity.failedTools} failed)` : ''}
          </span>
        ) : null}
        {activity.errorCount > 0 ? (
          <span className="text-danger">Errors: {activity.errorCount}</span>
        ) : null}
      </div>
      {activity.thinking ? (
        <div className="mt-1 truncate text-muted-foreground">Thinking: {activity.thinking}</div>
      ) : null}
    </div>
  );
}

export function AssistantTimeline({
  threadId,
  events,
  userMessages,
  isRunning,
}: {
  threadId: string | null;
  events: TerminalEventRecord[];
  userMessages: AssistantTimelineUserMessage[];
  isRunning: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const items = useMemo(() => {
    if (!threadId) return [];
    const userItems: ConversationItem[] = userMessages.flatMap((message) =>
      message.threadId === threadId
        ? [
            {
              id: message.id,
              kind: 'user' as const,
              content: message.content,
              createdAt: message.createdAt,
            },
          ]
        : [],
    );
    const eventItems = buildConversationItems(events);
    return [...userItems, ...eventItems].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt),
    );
  }, [events, threadId, userMessages]);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView !== 'function') return;
    bottomRef.current.scrollIntoView({ block: 'end' });
  });

  if (!threadId) return null;

  if (items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5 text-sm text-secondary">
        <AgentActivityOverview events={events} isRunning={isRunning} />
        <div className="flex flex-1 items-center justify-center">
          {isRunning ? <AnimatedThinkingWord /> : 'No assistant messages yet.'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto flex flex-col gap-3">
        {items.map((item) => {
          if (item.kind === 'user') {
            return (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[78%] rounded-lg border border-agent/25 bg-agent/15 px-3.5 py-2.5 text-primary text-xs leading-5 shadow-sm">
                  <div className="mb-1 text-[10px] text-agent">
                    {formatClockTime(item.createdAt)}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{item.content}</div>
                </div>
              </div>
            );
          }

          if (item.kind === 'assistant') {
            return (
              <div key={item.id} className="flex justify-start">
                <div className="max-w-[84%] rounded-lg border border-border bg-elevated px-3.5 py-2.5 text-primary text-xs leading-5 shadow-sm">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    {formatClockTime(item.createdAt)}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{item.content}</div>
                </div>
              </div>
            );
          }

          if (item.kind === 'thinking') {
            const PREVIEW_LEN = 80;
            const preview =
              item.content.length > PREVIEW_LEN
                ? `${item.content.slice(0, PREVIEW_LEN).trimEnd()}...`
                : item.content;
            return (
              <div key={item.id} className="flex justify-start px-1">
                <CollapsibleSection
                  title={`Thinking: ${preview}`}
                  count={formatClockTime(item.createdAt)}
                  className="w-full max-w-[84%] border-border/40 bg-secondary/30 px-3 py-1.5"
                  contentClassName="mt-2"
                >
                  <div className="mt-2 whitespace-pre-wrap break-words text-[11px] italic leading-5 text-secondary/80">
                    {item.content}
                  </div>
                </CollapsibleSection>
              </div>
            );
          }

          if (item.kind === 'tool') {
            const failed = typeof item.exitCode === 'number' && item.exitCode !== 0;
            const durationLabel =
              typeof item.durationMs === 'number'
                ? `${(item.durationMs / 1000).toFixed(1)}s`
                : null;

            const oneLiner = (
              <div key={`${item.id}:summary`} className="flex items-center gap-2 text-[11px]">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                  {formatClockTime(item.createdAt)}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide',
                    failed
                      ? 'border border-danger/30 bg-danger/15 text-danger'
                      : 'border border-border/50 bg-border/60 text-secondary',
                  )}
                >
                  {item.name || 'tool'}
                </span>
                {item.summary ? (
                  <span className="truncate text-muted-foreground">{item.summary}</span>
                ) : null}
                {durationLabel ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {durationLabel}
                  </span>
                ) : null}
                {failed ? (
                  <span className="shrink-0 text-[10px] text-danger">exit {item.exitCode}</span>
                ) : null}
              </div>
            );

            if (!failed || !item.outputSummary) {
              return (
                <div key={item.id} className="px-1">
                  {oneLiner}
                </div>
              );
            }

            return (
              <div key={item.id} className="px-1">
                <CollapsibleSection
                  title={[item.name || 'tool', item.summary].filter(Boolean).join(' - ')}
                  count={[
                    durationLabel,
                    failed && typeof item.exitCode === 'number' ? `exit ${item.exitCode}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  className="border-danger/20 bg-danger/5 px-3 py-1.5"
                  contentClassName="mt-2"
                >
                  {oneLiner}
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-danger">
                    {item.outputSummary}
                  </pre>
                </CollapsibleSection>
              </div>
            );
          }

          if (item.kind === 'activity') {
            return (
              <div key={item.id} className="px-1">
                <div className="flex items-start gap-2 text-[11px] text-secondary">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {formatClockTime(item.createdAt)}
                  </span>
                  <span className="break-words">{item.content}</span>
                </div>
              </div>
            );
          }

          if (item.kind === 'error') {
            return (
              <div key={item.id} className="px-1">
                <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/8 px-3 py-1.5 text-[11px]">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {formatClockTime(item.createdAt)}
                  </span>
                  <span className="font-medium text-danger">Error</span>
                  <span className="break-words text-danger/80">{item.message}</span>
                </div>
              </div>
            );
          }

          return null;
        })}
        <AgentActivityOverview events={events} isRunning={isRunning} />
        {isRunning ? (
          <div className="flex items-center justify-start px-1">
            <AnimatedThinkingWord />
          </div>
        ) : null}
        <div ref={bottomRef} className="h-px shrink-0" />
      </div>
    </div>
  );
}
