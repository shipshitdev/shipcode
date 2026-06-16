import type { AgentConversationRecord } from '@shipcode/shared';
import { Badge, Button, Skeleton } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, CopyIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

const PHASE_COLORS: Record<string, string> = {
  plan: 'bg-blue-500/15 text-blue-400',
  review: 'bg-amber-500/15 text-amber-400',
  revision: 'bg-purple-500/15 text-purple-400',
  execute: 'bg-green-500/15 text-green-400',
  verify: 'bg-cyan-500/15 text-cyan-400',
  issue_chat: 'bg-sky-500/15 text-sky-400',
};

const SPEAKER_COLORS: Record<string, string> = {
  pipeline: 'bg-zinc-500/15 text-zinc-400',
  claude: 'bg-orange-500/15 text-orange-400',
  codex: 'bg-emerald-500/15 text-emerald-400',
  openrouter: 'bg-violet-500/15 text-violet-400',
};

const ALL_PHASES = ['plan', 'review', 'revision', 'execute', 'verify', 'issue_chat'] as const;
const COLLAPSE_LINE_THRESHOLD = 30;
type GithubPostState = 'hidden' | 'idle' | 'posting' | 'posted';

interface ConversationsTabProps {
  threadId: string;
  projectId: string;
  issueNumber: number;
}

export function ConversationsTab({ threadId, projectId, issueNumber }: ConversationsTabProps) {
  const queryClient = useQueryClient();
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set(ALL_PHASES));
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);

  const { data: conversations = [], isLoading } = useQuery<AgentConversationRecord[]>({
    queryKey: ['agent-conversations', threadId],
    queryFn: () => window.shipcode.invoke('agent-conversations:list-by-thread', { threadId }),
    enabled: !!threadId,
  });

  const filtered = useMemo(
    () => conversations.filter((c) => selectedPhases.has(c.phase)),
    [conversations, selectedPhases],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, AgentConversationRecord[]> = {};
    for (const conv of filtered) {
      const key = conv.phase;
      if (!groups[key]) groups[key] = [];
      groups[key].push(conv);
    }
    return groups;
  }, [filtered]);

  const togglePhase = useCallback((phase: string) => {
    setSelectedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const copyTurn = useCallback(async (conv: AgentConversationRecord) => {
    const md = `**${conv.speaker}** (${conv.phase}, ${conv.role})\n\n${conv.content}`;
    await navigator.clipboard.writeText(md);
    setCopiedId(conv.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const copyAll = useCallback(async () => {
    const md = filtered
      .map((c) => `### ${c.speaker} — ${c.phase} (${c.role})\n\n${c.content}`)
      .join('\n\n---\n\n');
    await navigator.clipboard.writeText(md);
    setCopiedId('__all__');
    setTimeout(() => setCopiedId(null), 1500);
  }, [filtered]);

  const postTurn = useMutation({
    mutationFn: (conv: AgentConversationRecord) =>
      window.shipcode.invoke('github:add-comment', {
        projectId,
        issueNumber,
        body: `### ShipCode issue chat reply\n\n${conv.content}`,
      }),
    onSuccess: (_result, conv) => {
      setPostedId(conv.id);
      setTimeout(() => setPostedId(null), 1500);
      queryClient.invalidateQueries({ queryKey: ['issue-comments', projectId, issueNumber] });
    },
  });

  const confirmAndPostTurn = useCallback(
    (conv: AgentConversationRecord) => {
      const confirmed = window.confirm('Post this issue chat reply to GitHub?');
      if (!confirmed) return;
      postTurn.mutate(conv);
    },
    [postTurn],
  );

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        No conversation turns recorded yet. Turns appear after a pipeline run completes a phase.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Phase filter chips + copy all */}
      <div className="flex items-center gap-2 flex-wrap">
        {ALL_PHASES.map((phase) => (
          <Button
            key={phase}
            type="button"
            variant="ghost"
            onClick={() => togglePhase(phase)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity ${
              PHASE_COLORS[phase]
            } ${selectedPhases.has(phase) ? 'opacity-100' : 'opacity-30'}`}
          >
            {phase}
          </Button>
        ))}
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={copyAll} className="h-7 text-xs gap-1">
            {copiedId === '__all__' ? (
              <CheckIcon className="size-3" />
            ) : (
              <CopyIcon className="size-3" />
            )}
            Copy all
          </Button>
        </div>
      </div>

      {/* Grouped by phase */}
      {Object.entries(grouped).map(([phase, turns]) => (
        <div key={phase} className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            {phase} ({turns.length})
          </h3>
          {turns.map((conv) => {
            const canPostToGithub = conv.phase === 'issue_chat' && conv.role === 'response';
            const githubPostState: GithubPostState = !canPostToGithub
              ? 'hidden'
              : postTurn.isPending && postTurn.variables?.id === conv.id
                ? 'posting'
                : postedId === conv.id
                  ? 'posted'
                  : 'idle';
            return (
              <ConversationTurn
                key={conv.id}
                conv={conv}
                isExpanded={expandedTurns.has(conv.id)}
                isCopied={copiedId === conv.id}
                onToggleExpand={() => toggleExpand(conv.id)}
                onCopy={() => copyTurn(conv)}
                onPostToGithub={canPostToGithub ? () => confirmAndPostTurn(conv) : undefined}
                githubPostState={githubPostState}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ConversationTurn({
  conv,
  isExpanded,
  isCopied,
  onToggleExpand,
  onCopy,
  onPostToGithub,
  githubPostState,
}: {
  conv: AgentConversationRecord;
  isExpanded: boolean;
  isCopied: boolean;
  onToggleExpand: () => void;
  onCopy: () => void;
  onPostToGithub?: () => void;
  githubPostState: GithubPostState;
}) {
  const lines = conv.content.split('\n');
  const isLong = lines.length > COLLAPSE_LINE_THRESHOLD;
  const displayContent =
    isLong && !isExpanded
      ? `${lines.slice(0, COLLAPSE_LINE_THRESHOLD).join('\n')}\n…`
      : conv.content;

  const speakerColor =
    SPEAKER_COLORS[conv.speaker] ??
    SPEAKER_COLORS[conv.provider ?? ''] ??
    'bg-zinc-500/15 text-zinc-400';
  const phaseColor = PHASE_COLORS[conv.phase] ?? 'bg-zinc-500/15 text-zinc-400';

  return (
    <div className="border-border/50 rounded-lg border p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={`${speakerColor} text-[10px]`}>{conv.speaker}</Badge>
        <Badge className={`${phaseColor} text-[10px]`}>{conv.phase}</Badge>
        <Badge variant="default" className="text-[10px]">
          {conv.role}
        </Badge>
        {conv.model && <span className="text-muted-foreground text-[10px]">{conv.model}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {conv.tokensIn != null && (
            <span className="text-muted-foreground text-[10px]">
              {conv.tokensIn.toLocaleString()}→{(conv.tokensOut ?? 0).toLocaleString()} tok
            </span>
          )}
          {conv.costUsd != null && conv.costUsd > 0 && (
            <span className="text-muted-foreground text-[10px]">${conv.costUsd.toFixed(4)}</span>
          )}
          {onPostToGithub && githubPostState !== 'hidden' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onPostToGithub}
              disabled={githubPostState === 'posting'}
              className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <MessageSquarePlusIcon className="size-3" />
              <LoadingButtonContent loading={githubPostState === 'posting'}>
                {githubPostState === 'posted' ? 'Posted' : 'Post'}
              </LoadingButtonContent>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCopy}
            className="size-6 text-muted-foreground hover:text-foreground transition-colors p-0.5"
          >
            {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </Button>
        </div>
      </div>

      {/* Content */}
      <pre className="text-foreground/90 whitespace-pre-wrap break-words text-xs leading-relaxed font-mono">
        {displayContent}
      </pre>

      {isLong && (
        <Button
          type="button"
          variant="link"
          size="xs"
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          {isExpanded ? 'Show less' : `Show full (${lines.length} lines)`}
        </Button>
      )}
    </div>
  );
}
