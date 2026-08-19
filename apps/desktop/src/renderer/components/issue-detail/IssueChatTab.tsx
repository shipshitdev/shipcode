import {
  type AgentConversationRecord,
  clampError,
  type ReasoningEffort,
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
import { RefreshCw, Send, Square } from 'lucide-react';
import { useCallback, useMemo, useReducer } from 'react';
import { toast } from '../../stores/toast-store';
import {
  AssistantTimeline,
  type AssistantTimelineMessage,
  type AssistantTimelineUserMessage,
  useAssistantTranscript,
} from '../assistant/AssistantTimeline';

type IssueChatProvider = 'claude' | 'codex' | 'grok';

interface IssueChatSessionMetadata {
  threadId: string;
  provider: IssueChatProvider;
  sessionId: string | null;
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  worktreePath: string;
}

interface IssueChatStartResult extends IssueChatSessionMetadata {
  reattached: boolean;
  activeProcessId: string | null;
}

interface IssueChatTabProps {
  threadId: string;
  issueNumber: number;
  issueTitle: string;
}

function isIssueChatTurnRunning({
  events,
  isSubmitting,
}: {
  events: TerminalEventRecord[];
  isSubmitting: boolean;
}) {
  if (isSubmitting) return true;
  const latestEvent = events[events.length - 1]?.event;
  if (!latestEvent) return false;
  if (latestEvent.kind === 'done') return false;
  if (
    latestEvent.kind === 'lifecycle' &&
    (/exited with code/i.test(latestEvent.message) ||
      /session stopped/i.test(latestEvent.message) ||
      /process exited/i.test(latestEvent.message))
  ) {
    return false;
  }
  return true;
}

function appendLocalUserMessage(
  threadId: string,
  content: string,
  count: number,
): AssistantTimelineUserMessage {
  return {
    id: `${threadId}:issue-chat:${Date.now()}:${count}`,
    threadId,
    content,
    createdAt: new Date().toISOString(),
  };
}

interface IssueChatUiState {
  draft: string;
  selectedProvider: IssueChatProvider;
  sessionStarted: boolean;
  isSubmitting: boolean;
  userMessages: AssistantTimelineUserMessage[];
}

type IssueChatUiAction =
  | { type: 'draft'; value: string }
  | { type: 'selected-provider'; provider: IssueChatProvider }
  | { type: 'session-started'; value: boolean }
  | { type: 'submitting'; value: boolean }
  | { type: 'queued-user-message'; threadId: string; content: string };

const ISSUE_CHAT_INITIAL_STATE: IssueChatUiState = {
  draft: '',
  selectedProvider: 'claude',
  sessionStarted: false,
  isSubmitting: false,
  userMessages: [],
};

function issueChatUiReducer(state: IssueChatUiState, action: IssueChatUiAction): IssueChatUiState {
  switch (action.type) {
    case 'draft':
      return { ...state, draft: action.value };
    case 'selected-provider':
      return { ...state, selectedProvider: action.provider };
    case 'session-started':
      return { ...state, sessionStarted: action.value };
    case 'submitting':
      return { ...state, isSubmitting: action.value };
    case 'queued-user-message':
      return {
        ...state,
        draft: '',
        userMessages: [
          ...state.userMessages,
          appendLocalUserMessage(action.threadId, action.content, state.userMessages.length),
        ],
      };
  }
}

export function IssueChatTab({ threadId, issueNumber, issueTitle }: IssueChatTabProps) {
  const queryClient = useQueryClient();
  const transcript = useAssistantTranscript(threadId);
  const { data: issueChatConversations = [] } = useQuery<AgentConversationRecord[]>({
    queryKey: ['agent-conversations', threadId, 'issue_chat'],
    queryFn: () =>
      window.shipcode.invoke('agent-conversations:list-by-thread', {
        threadId,
        phase: 'issue_chat',
      }),
    enabled: !!threadId,
  });
  const { data: issueChatSession = null } = useQuery<IssueChatSessionMetadata | null>({
    queryKey: ['issue-chat-session', threadId],
    queryFn: () => window.shipcode.invoke('issue-chat:get-session', { threadId }),
    enabled: !!threadId,
  });
  const [issueChatState, dispatchIssueChat] = useReducer(
    issueChatUiReducer,
    ISSUE_CHAT_INITIAL_STATE,
  );
  const { draft, selectedProvider, sessionStarted, isSubmitting, userMessages } = issueChatState;
  const provider = issueChatSession?.provider ?? selectedProvider;

  const isRunning = useMemo(
    () => isIssueChatTurnRunning({ events: transcript, isSubmitting }),
    [isSubmitting, transcript],
  );
  const persistedMessages = useMemo<AssistantTimelineMessage[]>(
    () =>
      issueChatConversations.map((turn) => ({
        id: turn.id,
        kind: turn.role === 'prompt' ? 'user' : 'assistant',
        threadId: turn.threadId,
        content: turn.content,
        createdAt: turn.createdAt,
      })),
    [issueChatConversations],
  );
  const persistedPromptContents = useMemo(
    () =>
      new Set(
        issueChatConversations.flatMap((turn) =>
          turn.role === 'prompt' ? [turn.content.trim()] : [],
        ),
      ),
    [issueChatConversations],
  );
  const pendingUserMessages = useMemo(
    () => userMessages.filter((message) => !persistedPromptContents.has(message.content.trim())),
    [persistedPromptContents, userMessages],
  );
  const visibleEvents = persistedMessages.length > 0 && !isRunning ? [] : transcript;
  const hasVisibleConversation =
    persistedMessages.length > 0 || pendingUserMessages.length > 0 || visibleEvents.length > 0;
  const canResume = issueChatSession != null && !sessionStarted && !isRunning;

  const startOrResumeSession = useCallback(async () => {
    const result = await window.shipcode.invoke<IssueChatStartResult>('issue-chat:start', {
      threadId,
      provider,
      modelId: issueChatSession?.modelId ?? undefined,
      reasoningEffort: issueChatSession?.reasoningEffort ?? 'medium',
    });
    dispatchIssueChat({ type: 'selected-provider', provider: result.provider });
    dispatchIssueChat({ type: 'session-started', value: true });
    await queryClient.invalidateQueries({
      queryKey: ['issue-chat-session', threadId],
    });
  }, [issueChatSession, provider, queryClient, threadId]);

  const submitTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSubmitting || isRunning) return;
      dispatchIssueChat({ type: 'submitting', value: true });
      try {
        if (!sessionStarted) {
          await startOrResumeSession();
        }

        dispatchIssueChat({ type: 'queued-user-message', threadId, content: trimmed });

        await window.shipcode.invoke('issue-chat:turn', { threadId, text: trimmed });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['agent-conversations', threadId],
          }),
          queryClient.invalidateQueries({
            queryKey: ['agent-conversations', threadId, 'issue_chat'],
          }),
          queryClient.invalidateQueries({
            queryKey: ['issue-chat-session', threadId],
          }),
        ]);
      } catch (error) {
        toast.error('Issue chat failed', clampError(error));
      } finally {
        dispatchIssueChat({ type: 'submitting', value: false });
      }
    },
    [isRunning, isSubmitting, queryClient, sessionStarted, startOrResumeSession, threadId],
  );

  const handleSubmit = useCallback(() => {
    void submitTurn(draft);
  }, [draft, submitTurn]);

  const handleStop = useCallback(async () => {
    try {
      await window.shipcode.invoke('issue-chat:stop', { threadId });
      dispatchIssueChat({ type: 'session-started', value: false });
    } catch (error) {
      toast.error('Issue chat stop failed', clampError(error));
    }
  }, [threadId]);

  const handleResume = useCallback(async () => {
    try {
      await startOrResumeSession();
    } catch (error) {
      toast.error('Issue chat resume failed', clampError(error));
    }
  }, [startOrResumeSession]);

  const setSuggestedPrompt = useCallback((prompt: string) => {
    dispatchIssueChat({ type: 'draft', value: prompt });
  }, []);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-primary"
      data-testid="conversation-surface"
    >
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Agent · #{issueNumber}
          </div>
          <div className="truncate text-[12px] text-secondary">{issueTitle}</div>
        </div>
        <Badge variant={isRunning ? 'default' : sessionStarted ? 'done' : 'info'}>
          {isRunning
            ? 'Running'
            : sessionStarted
              ? 'Ready'
              : issueChatSession
                ? 'Resumable'
                : 'Idle'}
        </Badge>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {hasVisibleConversation ? (
          <AssistantTimeline
            threadId={threadId}
            events={visibleEvents}
            messages={persistedMessages}
            userMessages={pendingUserMessages}
            isRunning={isRunning}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-8 text-sm text-secondary">
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
              Waiting
            </p>
            <p className="text-[15px] font-medium tracking-tight text-primary">
              Talk to the official CLI on this issue.
            </p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start px-0 py-0 text-left text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-primary"
                onClick={() => setSuggestedPrompt(`Explain issue #${issueNumber}: ${issueTitle}`)}
              >
                Explain this issue.
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start px-0 py-0 text-left text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-primary"
                onClick={() =>
                  setSuggestedPrompt(`Draft an implementation approach for issue #${issueNumber}.`)
                }
              >
                Draft an approach.
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start px-0 py-0 text-left text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-primary"
                onClick={() =>
                  setSuggestedPrompt(`What files should change for issue #${issueNumber}?`)
                }
              >
                What files would change?
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/70 bg-primary p-3">
        <div className="flex w-full flex-col rounded-md border border-border/80 bg-elevated/60">
          <Textarea
            value={draft}
            onChange={(event) => dispatchIssueChat({ type: 'draft', value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !isRunning) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Message Claude, Codex, or Grok…"
            className="min-h-[76px] resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1.5">
            <Select
              value={provider}
              onValueChange={(next) =>
                dispatchIssueChat({
                  type: 'selected-provider',
                  provider: next as IssueChatProvider,
                })
              }
              disabled={sessionStarted || isRunning || issueChatSession != null}
            >
              <SelectTrigger
                aria-label="Issue chat provider"
                className="h-6 w-auto gap-1 rounded border-0 bg-transparent px-1.5 text-[10px] text-muted-foreground hover:text-primary"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="grok">Grok</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            {canResume ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleResume()}
                className="h-6 gap-1.5 text-[10px]"
                title="Resume"
              >
                <RefreshCw size={10} />
                Resume
              </Button>
            ) : isRunning ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleStop()}
                className="h-6 gap-1.5 text-[10px]"
                title="Stop"
              >
                <Square size={10} />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                size="icon"
                disabled={!draft.trim() || isSubmitting}
                onClick={handleSubmit}
                className={cn('h-6 w-6 rounded-full', isSubmitting && 'opacity-80')}
                title="Send"
              >
                <Send size={12} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
