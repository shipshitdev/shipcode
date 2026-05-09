import type {
  AppSettings,
  Project,
  ProjectSetupDraft,
  TerminalEventRecord,
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
import { Bot, ExternalLink, Loader2, Plus, Send, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { type AssistantCli, useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import { TerminalTranscript } from './terminal-transcript/TerminalTranscript';

const EMPTY_STREAM: TerminalEventRecord[] = [];

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

export function AssistantPanel() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeIssue = useAppStore((state) => state.activeIssue);
  const assistantDraft = useAppStore((state) => state.assistantDraft);
  const assistantQueuedPrompt = useAppStore((state) => state.assistantQueuedPrompt);
  const assistantThreadId = useAppStore((state) => state.assistantThreadId);
  const assistantCli = useAppStore((state) => state.assistantCli);
  const closeAssistant = useAppStore((state) => state.closeAssistant);
  const setAssistantDraft = useAppStore((state) => state.setAssistantDraft);
  const clearAssistantQueuedPrompt = useAppStore((state) => state.clearAssistantQueuedPrompt);
  const setAssistantThread = useAppStore((state) => state.setAssistantThread);
  const setAssistantCli = useAppStore((state) => state.setAssistantCli);
  const addTerminalPane = useAppStore((state) => state.addTerminalPane);
  const openTerminalTab = useAppStore((state) => state.openTerminalTab);
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
    void runAssistant(assistantDraft);
  }, [assistantDraft, runAssistant]);

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

  const handleOpenTerminal = useCallback(() => {
    if (!assistantThreadId || !activeProjectId) return;
    addTerminalPane(assistantThreadId, {
      mode: transcriptRunning ? 'live' : 'replay',
      title: 'ShipCode Assistant',
      cli: assistantCli,
      state: transcriptRunning ? 'running' : 'exited',
    });
    openTerminalTab();
  }, [
    activeProjectId,
    addTerminalPane,
    assistantCli,
    assistantThreadId,
    openTerminalTab,
    transcriptRunning,
  ]);

  return (
    <aside className="flex w-[390px] shrink-0 flex-col border-l border-border bg-secondary">
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
          <TerminalTranscript
            events={transcript}
            pendingLabel={
              transcript.length === 0 && transcriptRunning ? 'Starting assistant' : null
            }
            emptyMessage="No assistant output yet."
            compact
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-5 text-sm text-secondary">
            <p className="text-primary">
              Ask ShipCode to inspect setup, explain board state, or draft issues.
            </p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <button
                type="button"
                className="block text-left hover:text-primary"
                onClick={() =>
                  setAssistantDraft('Review this project setup and tell me what is missing.')
                }
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
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-primary p-3">
        <Textarea
          value={assistantDraft}
          onChange={(event) => setAssistantDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Ask about setup, issues, or the board..."
          className="min-h-[76px] resize-none text-xs"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!assistantThreadId || !activeProjectId}
            onClick={handleOpenTerminal}
            className="h-7 gap-1.5 text-xs"
          >
            <ExternalLink size={12} />
            Terminal
          </Button>
          <div className="flex items-center gap-1.5">
            {transcriptRunning ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCancel}
                className="h-7 gap-1.5 text-xs"
              >
                <Square size={11} />
                Stop
              </Button>
            ) : null}
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!assistantDraft.trim() || isSubmitting || !activeProjectId}
              onClick={handleSubmit}
              className={cn('h-7 gap-1.5 text-xs', isSubmitting && 'opacity-80')}
            >
              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Send
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
