import type { AgentConversationRecord, TerminalEventRecord } from '@shipcode/shared';
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
import { Bot, Send, Square } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from '../../stores/toast-store';
import {
  AssistantTimeline,
  type AssistantTimelineMessage,
  type AssistantTimelineUserMessage,
  useAssistantTranscript,
} from '../assistant/AssistantTimeline';

type IssueChatProvider = 'claude' | 'codex';

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
  const [draft, setDraft] = useState('');
  const [provider, setProvider] = useState<IssueChatProvider>('claude');
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userMessages, setUserMessages] = useState<AssistantTimelineUserMessage[]>([]);

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
        issueChatConversations
          .filter((turn) => turn.role === 'prompt')
          .map((turn) => turn.content.trim()),
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

  const submitTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSubmitting || isRunning) return;
      setIsSubmitting(true);
      try {
        if (!sessionStarted) {
          await window.shipcode.invoke('issue-chat:start', {
            threadId,
            provider,
            reasoningEffort: 'medium',
          });
          setSessionStarted(true);
        }

        setUserMessages((previous) => [
          ...previous,
          appendLocalUserMessage(threadId, trimmed, previous.length),
        ]);
        setDraft('');

        await window.shipcode.invoke('issue-chat:turn', { threadId, text: trimmed });
        await queryClient.invalidateQueries({
          queryKey: ['agent-conversations', threadId],
        });
        await queryClient.invalidateQueries({
          queryKey: ['agent-conversations', threadId, 'issue_chat'],
        });
      } catch (error) {
        toast.error('Issue chat failed', error instanceof Error ? error.message : undefined);
      } finally {
        setIsSubmitting(false);
      }
    },
    [isRunning, isSubmitting, provider, queryClient, sessionStarted, threadId],
  );

  const handleSubmit = useCallback(() => {
    void submitTurn(draft);
  }, [draft, submitTurn]);

  const handleStop = useCallback(async () => {
    try {
      await window.shipcode.invoke('issue-chat:stop', { threadId });
      setSessionStarted(false);
    } catch (error) {
      toast.error('Issue chat stop failed', error instanceof Error ? error.message : undefined);
    }
  }, [threadId]);

  const setSuggestedPrompt = useCallback((prompt: string) => {
    setDraft(prompt);
  }, []);

  return (
    <section className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-md border border-border bg-primary">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex size-7 items-center justify-center rounded-md border border-border bg-secondary">
          <Bot size={14} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-primary">Issue Chat</div>
          <div className="truncate text-[10px] text-muted-foreground">
            #{issueNumber} {issueTitle}
          </div>
        </div>
        <Badge variant={isRunning ? 'default' : sessionStarted ? 'done' : 'info'}>
          {isRunning ? 'Running' : sessionStarted ? 'Ready' : 'Idle'}
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
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-5 text-sm text-secondary">
            <p className="text-primary">No chat yet.</p>
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

      <div className="shrink-0 border-t border-border bg-primary p-3">
        <div className="flex w-full flex-col rounded-lg border border-border bg-elevated">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !isRunning) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask the issue agent..."
            className="min-h-[76px] resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1.5">
            <Select
              value={provider}
              onValueChange={(next) => setProvider(next as IssueChatProvider)}
              disabled={sessionStarted || isRunning}
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
              </SelectContent>
            </Select>
            <div className="flex-1" />
            {isRunning ? (
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
