import type { GitHubIssueCacheRecord, PipelinePhase } from '@shipcode/shared';
import {
  Button,
  ChevronDown,
  ChevronUp,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  PhaseChip,
  Plus,
  X,
} from '@shipcode/ui';

interface TerminalDrawerHeaderProps {
  activeProjectId: string | null;
  currentModel: string | null;
  displayIssue: GitHubIssueCacheRecord | null;
  ghosttyAvailable: boolean;
  isMaximized: boolean;
  pipelinePhase: PipelinePhase;
  runningTabs: GitHubIssueCacheRecord[];
  startedAt: string | null;
  terminalAvailable: boolean;
  terminalThreadId: string | null;
  onNewClaudeSession: () => void;
  onNewCodexSession: () => void;
  onOpenInGhostty: () => void;
  onOpenInTerminalApp: () => void;
  onOpenIssue: (issue: GitHubIssueCacheRecord) => void;
  onToggleMaximize: () => void;
  onToggleTerminal: () => void;
}

export function TerminalDrawerHeader({
  currentModel,
  displayIssue,
  ghosttyAvailable,
  isMaximized,
  pipelinePhase,
  runningTabs,
  startedAt,
  terminalAvailable,
  terminalThreadId,
  onNewClaudeSession,
  onNewCodexSession,
  onOpenInGhostty,
  onOpenInTerminalApp,
  onOpenIssue,
  onToggleMaximize,
  onToggleTerminal,
}: TerminalDrawerHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-primary/75 px-3 py-1.5 shrink-0 gap-3 min-w-0">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <div className="shrink-0">
          <span className="rounded-md bg-tertiary px-3 py-1 text-[11px] font-medium text-primary">
            Console
          </span>
        </div>

        <div className="flex items-center gap-2 min-w-0 overflow-hidden border-l border-border pl-3">
          {displayIssue &&
            (runningTabs.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal text-secondary hover:bg-transparent hover:text-primary"
                  >
                    <span className="font-mono text-muted">#{displayIssue.issueNumber}</span>
                    <span className="truncate max-w-[240px]">{displayIssue.title}</span>
                    <ChevronDown size={11} className="text-muted shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  {runningTabs.map((issue) => (
                    <DropdownMenuItem
                      key={issue.threadId}
                      onSelect={() => onOpenIssue(issue)}
                      className={cn(issue.threadId === terminalThreadId && 'bg-hover text-primary')}
                    >
                      <span className="font-mono text-muted text-xs">#{issue.issueNumber}</span>
                      <span className="truncate max-w-[280px]">{issue.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onOpenIssue(displayIssue)}
                className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal text-secondary hover:bg-transparent hover:text-primary"
                title={`Open issue detail for #${displayIssue.issueNumber}`}
              >
                <span className="font-mono text-muted">#{displayIssue.issueNumber}</span>
                <span className="truncate hover:text-primary">{displayIssue.title}</span>
              </Button>
            ))}

          {pipelinePhase !== 'idle' && <PhaseChip status={pipelinePhase} className="shrink-0" />}

          {currentModel && pipelinePhase !== 'idle' && (
            <span className="text-xs font-mono text-muted shrink-0 truncate max-w-[180px]">
              {currentModel}
            </span>
          )}

          {startedAt && <span className="text-xs font-mono text-muted shrink-0">{startedAt}</span>}
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" title="New session" aria-label="New session">
              <Plus size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem onSelect={onNewClaudeSession}>New Claude Session</DropdownMenuItem>
            <DropdownMenuItem onSelect={onNewCodexSession}>New Codex Session</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenInGhostty} disabled={!ghosttyAvailable}>
              Open in Ghostty
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenInTerminalApp} disabled={!terminalAvailable}>
              Open in Terminal.app
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted hover:bg-hover/70 hover:text-primary"
          onClick={onToggleMaximize}
          title={isMaximized ? 'Collapse terminal' : 'Expand terminal'}
          aria-label={isMaximized ? 'Collapse terminal' : 'Expand terminal'}
        >
          {isMaximized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted hover:bg-hover/70 hover:text-primary"
          onClick={onToggleTerminal}
          title="Close terminal"
          aria-label="Close terminal"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
