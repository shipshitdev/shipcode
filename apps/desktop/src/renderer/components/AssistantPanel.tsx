import {
  type AppSettings,
  formatClockTime,
  type Project,
  type ProjectSetupDraft,
  stripAnsi,
  type TerminalEventRecord,
} from '@shipcode/shared';
import {
  Badge,
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Send, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { type AssistantCli, type AssistantUserMessage, useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';

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

function setupSummary(setup: ProjectSetupDraft | null): string {
  if (!setup) return 'Setup contract: not loaded.';
  const contract = setup.inspection.contract ?? setup.suggestedContract;
  return [
    `Setup status: ${setup.inspection.status}`,
    `Setup file: ${setup.inspection.path}`,
    `Setup commands: ${contract.setupCommands.length ? contract.setupCommands.join(' && ') : 'none'}`,
    `Verify commands: ${contract.verifyCommands.length ? contract.verifyCommands.join(' && ') : 'none'}`,
    `Setup before verify: ${contract.setupBeforeVerify ? 'yes' : 'no'}`,
    contract.testingContext ? `Testing context: ${contract.testingContext}` : null,
    setup.profiles.length
      ? `Detected profiles: ${setup.profiles.map((p) => `${p.label}${p.recommended ? ' (recommended)' : ''}`).join(', ')}`
      : 'Detected profiles: none',
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}

function buildAssistantSystemPrompt(args: {
  project: Project | null;
  activeIssueTitle: string | null;
  viewMode: string;
  projectTab: string;
  setup: ProjectSetupDraft | null;
}): string {
  const { project, activeIssueTitle, viewMode, projectTab, setup } = args;
  return [
    'You are the ShipCode in-app assistant.',
    '',
    'Mission:',
    '- Help the user verify and improve ShipCode setup.',
    '- Help manage the current Kanban board and GitHub issues.',
    '- Prefer concrete inspection and exact next actions over generic advice.',
    '',
    'Operating rules:',
    '- Read local files and run read-only commands when useful.',
    '- Do not make destructive changes unless the user clearly requested them.',
    '- For GitHub issue creation, produce a concise title/body/labels proposal before creating unless the user explicitly says to create it now.',
    '- For setup changes, explain the detected current contract and the proposed replacement before writing.',
    '- Keep responses concise and task-oriented.',
    '',
    'Current ShipCode context:',
    `- View: ${viewMode}`,
    `- Project tab: ${projectTab}`,
    project
      ? `- Project: ${project.name}\n- Project path: ${project.path}\n- GitHub repo: ${project.githubRepoFullName ?? 'unknown'}\n- GitHub Projects board: ${project.githubProjectUrl ?? 'not configured'}`
      : '- Project: none selected',
    activeIssueTitle ? `- Active issue: ${activeIssueTitle}` : '- Active issue: none',
    '',
    setupSummary(setup),
  ].join('\n');
}

function useAssistantTranscript(threadId: string | null) {
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

function rawActivityLines(content: string): string[] {
  const clean = stripAnsi(content)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[\d:.\s]+$/.test(line))
    .filter((line) => !/^esc to cancel/i.test(line))
    .filter((line) => !/^ctrl[+-]/i.test(line));

  return clean.slice(-6);
}

function buildConversationItems(records: TerminalEventRecord[]): ConversationItem[] {
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
          style={{ '--thinking-letter-index': delay } as React.CSSProperties}
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

function AssistantTimeline({
  threadId,
  events,
  userMessages,
  isRunning,
}: {
  threadId: string | null;
  events: TerminalEventRecord[];
  userMessages: AssistantUserMessage[];
  isRunning: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const items = useMemo(() => {
    if (!threadId) return [];
    const userItems: ConversationItem[] = userMessages
      .filter((message) => message.threadId === threadId)
      .map((message) => ({
        id: message.id,
        kind: 'user',
        content: message.content,
        createdAt: message.createdAt,
      }));
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-5 text-sm text-secondary">
        <AgentActivityOverview events={events} isRunning={isRunning} />
        <div className="flex flex-1 items-center justify-center">
          {isRunning ? <AnimatedThinkingWord /> : 'No assistant messages yet.'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
                ? `${item.content.slice(0, PREVIEW_LEN).trimEnd()}…`
                : item.content;
            return (
              <div key={item.id} className="flex justify-start px-1">
                <details className="w-full max-w-[84%] rounded-md border border-border/40 bg-secondary/30 px-3 py-1.5">
                  <summary className="cursor-pointer list-none text-[11px] text-muted-foreground italic">
                    <span className="mr-2 font-mono text-[10px] text-muted-foreground/60">
                      {formatClockTime(item.createdAt)}
                    </span>
                    Thinking: {preview}
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap break-words text-[11px] italic leading-5 text-secondary/80">
                    {item.content}
                  </div>
                </details>
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
                <details className="rounded-md border border-danger/20 bg-danger/5 px-3 py-1.5">
                  <summary className="cursor-pointer list-none">{oneLiner}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-danger">
                    {item.outputSummary}
                  </pre>
                </details>
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

function suggestedPromptButtons(setAssistantDraft: (draft: string) => void) {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <button
        type="button"
        className="block text-left hover:text-primary"
        onClick={() => setAssistantDraft('Review this project setup and tell me what is missing.')}
      >
        Review this project setup and tell me what is missing.
      </button>
      <button
        type="button"
        className="block text-left hover:text-primary"
        onClick={() =>
          setAssistantDraft('Look at the Kanban board and suggest what I should run next.')
        }
      >
        Look at the Kanban board and suggest what I should run next.
      </button>
      <button
        type="button"
        className="block text-left hover:text-primary"
        onClick={() => setAssistantDraft('Help me turn this idea into GitHub issues.')}
      >
        Help me turn this idea into GitHub issues.
      </button>
    </div>
  );
}

export function AssistantPanel() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeIssue = useAppStore((state) => state.activeIssue);
  const assistantDraft = useAppStore((state) => state.assistantDraft);
  const assistantQueuedPrompt = useAppStore((state) => state.assistantQueuedPrompt);
  const assistantThreadId = useAppStore((state) => state.assistantThreadId);
  const assistantCli = useAppStore((state) => state.assistantCli);
  const assistantUserMessages = useAppStore((state) => state.assistantUserMessages);
  const closeAssistant = useAppStore((state) => state.closeAssistant);
  const setAssistantDraft = useAppStore((state) => state.setAssistantDraft);
  const clearAssistantQueuedPrompt = useAppStore((state) => state.clearAssistantQueuedPrompt);
  const setAssistantThread = useAppStore((state) => state.setAssistantThread);
  const setAssistantCli = useAppStore((state) => state.setAssistantCli);
  const appendAssistantUserMessage = useAppStore((state) => state.appendAssistantUserMessage);
  const projectTab = useAppStore((state) => state.projectTab);
  const viewMode = useAppStore((state) => state.viewMode);
  const transcript = useAssistantTranscript(assistantThreadId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke<AppSettings>('settings:get'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: activeProject = null } = useQuery<Project | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => {
      if (!activeProjectId) throw new Error('Missing active project id');
      return window.shipcode.invoke<Project | null>('project:get', { projectId: activeProjectId });
    },
    enabled: !!activeProjectId,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const latestEvent = transcript[transcript.length - 1]?.event;
  const transcriptRunning = useMemo(() => {
    if (!assistantThreadId) return false;
    if (isSubmitting) return true;
    if (!latestEvent) return false;
    if (latestEvent.kind === 'done') return false;
    if (latestEvent.kind === 'lifecycle' && latestEvent.message.includes('process exited')) {
      return false;
    }
    return true;
  }, [assistantThreadId, isSubmitting, latestEvent]);

  const runAssistant = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || isSubmitting) return;
      if (!activeProjectId) {
        toast.error('Select a project before starting an assistant thread');
        return;
      }
      setIsSubmitting(true);
      try {
        if (assistantThreadId && transcriptRunning) {
          await window.shipcode.invoke('instant:shell-input', {
            threadId: assistantThreadId,
            data: `${trimmed}\n`,
          });
          appendAssistantUserMessage({ threadId: assistantThreadId, content: trimmed });
        } else {
          const setup = await window.shipcode
            .invoke<ProjectSetupDraft>('project:get-setup', { projectId: activeProjectId })
            .catch(() => null);
          const project =
            activeProject ??
            (await window.shipcode
              .invoke<Project | null>('project:get', { projectId: activeProjectId })
              .catch(() => null));
          const customSystemPrompt = buildAssistantSystemPrompt({
            project,
            activeIssueTitle: activeIssue?.title ?? null,
            viewMode,
            projectTab,
            setup,
          });
          const modelId =
            assistantCli === 'claude'
              ? settings?.prdRewriteClaudeModel
              : settings?.prdRewriteCodexModel;
          const initialPrompt = `${customSystemPrompt}\n\nUser request:\n${trimmed}`;
          const result = await window.shipcode.invoke<{ threadId: string }>('instant:shell-start', {
            projectId: activeProjectId,
            cli: assistantCli,
            modelId: modelId ?? null,
            reasoningEffort: 'medium',
            initialPrompt,
          });
          setAssistantThread(result.threadId);
          appendAssistantUserMessage({ threadId: result.threadId, content: trimmed });
        }
        setAssistantDraft('');
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'running'] });
      } catch (error) {
        toast.error('Assistant failed', error instanceof Error ? error.message : undefined);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeIssue?.title,
      activeProject,
      activeProjectId,
      assistantThreadId,
      assistantCli,
      appendAssistantUserMessage,
      isSubmitting,
      projectTab,
      queryClient,
      setAssistantDraft,
      setAssistantThread,
      settings?.prdRewriteClaudeModel,
      settings?.prdRewriteCodexModel,
      transcriptRunning,
      viewMode,
    ],
  );

  useEffect(() => {
    const queued = assistantQueuedPrompt?.trim();
    if (!queued) return;
    clearAssistantQueuedPrompt();
    void runAssistant(queued);
  }, [assistantQueuedPrompt, clearAssistantQueuedPrompt, runAssistant]);

  const handleSubmit = useCallback(() => {
    if (transcriptRunning) return;
    void runAssistant(assistantDraft);
  }, [assistantDraft, runAssistant, transcriptRunning]);

  const handleCancel = useCallback(() => {
    if (!assistantThreadId) return;
    void window.shipcode.invoke('instant:cancel', { threadId: assistantThreadId });
  }, [assistantThreadId]);

  const handleNewThread = useCallback(() => {
    if (assistantThreadId && transcriptRunning) {
      void window.shipcode.invoke('instant:cancel', { threadId: assistantThreadId });
    }
    setAssistantThread(null);
  }, [assistantThreadId, setAssistantThread, transcriptRunning]);

  return (
    <section className="flex h-full min-h-0 w-[390px] shrink-0 flex-col border-l border-border bg-secondary">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex size-7 items-center justify-center rounded-md border border-border bg-primary">
          <Bot size={14} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-primary">ShipCode Assistant</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {activeProject ? activeProject.name : 'Global setup'}
          </div>
        </div>
        {transcriptRunning ? (
          <Badge variant="default" className="text-[10px]">
            Running
          </Badge>
        ) : null}
        <Select
          value={assistantCli}
          onValueChange={(next) => setAssistantCli(next as AssistantCli)}
        >
          <SelectTrigger
            aria-label="Assistant CLI"
            className="h-7 w-[92px] shrink-0 rounded-md bg-primary text-[11px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">Claude CLI</SelectItem>
            <SelectItem value="codex">Codex CLI</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={handleNewThread}
          disabled={!assistantThreadId}
          title="New assistant thread"
        >
          <Plus size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={closeAssistant}
          title="Close assistant"
        >
          <X size={14} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-3 py-2">
          <Badge variant="default" className="text-[10px]">
            {viewMode}
          </Badge>
          {activeProject ? (
            <Badge variant="default" className="text-[10px]">
              {projectTab}
            </Badge>
          ) : null}
          {activeIssue ? (
            <Badge variant="default" className="max-w-[230px] truncate text-[10px]">
              #{activeIssue.issueNumber} {activeIssue.title}
            </Badge>
          ) : null}
        </div>

        {assistantThreadId ? (
          <AssistantTimeline
            threadId={assistantThreadId}
            events={transcript}
            userMessages={assistantUserMessages}
            isRunning={transcriptRunning}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-5 text-sm text-secondary">
            <p className="text-primary">
              Ask ShipCode to inspect setup, explain board state, or draft issues.
            </p>
            {suggestedPromptButtons(setAssistantDraft)}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-primary p-3">
        <div className="relative w-full">
          <Textarea
            value={assistantDraft}
            onChange={(event) => setAssistantDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !transcriptRunning) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask about setup, issues, or the board..."
            className="min-h-[92px] w-full resize-none pb-12 pr-24 text-xs"
          />
          {transcriptRunning ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCancel}
              disabled={!assistantThreadId}
              className="absolute right-2 bottom-2 h-7 gap-1.5 text-xs"
              title="Stop"
            >
              <Square size={11} />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!assistantDraft.trim() || isSubmitting || !activeProjectId}
              onClick={handleSubmit}
              className={cn(
                'absolute right-2 bottom-2 h-7 gap-1.5 text-xs',
                isSubmitting && 'opacity-80',
              )}
              title="Send"
            >
              <Send size={12} />
              Send
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
