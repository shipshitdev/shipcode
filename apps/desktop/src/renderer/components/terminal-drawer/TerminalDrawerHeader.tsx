import type { GitHubIssueCacheRecord, PipelinePhase } from '@shipcode/shared';
import {
  Button,
  ChevronDown,
  ChevronUp,
  Code2,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Ghost,
  PhaseChip,
  Sparkles,
  Terminal,
  X,
} from '@shipshitdev/ui';
import type { ReactNode } from 'react';

interface TerminalDrawerHeaderProps {
  activeProjectId: string | null;
  approvedAwaitingExecution?: boolean;
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

function MenuLogo({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border bg-primary/70',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function TerminalDrawerHeader({
  activeProjectId,
  approvedAwaitingExecution = false,
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

          {pipelinePhase !== 'idle' && (
            <PhaseChip
              status={pipelinePhase}
              label={approvedAwaitingExecution ? 'Waiting for slot' : undefined}
              className={cn(
                'shrink-0',
                approvedAwaitingExecution && 'border-agent/25 bg-agent/10 text-agent',
              )}
            />
          )}

          {currentModel && pipelinePhase !== 'idle' && (
            <span className="text-xs font-mono text-muted shrink-0 truncate max-w-[180px]">
              {currentModel}
            </span>
          )}

          {startedAt && <span className="text-xs font-mono text-muted shrink-0">{startedAt}</span>}
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="xs"
          className="h-6 gap-1 px-2 text-warning hover:bg-warning/10 hover:text-warning"
          disabled={!activeProjectId}
          onClick={onNewClaudeSession}
          title="New Claude shell"
          aria-label="New Claude shell"
        >
          <Sparkles size={13} />
          <span className="hidden sm:inline">Claude</span>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 gap-1 px-2 text-agent hover:bg-agent/10 hover:text-agent"
          disabled={!activeProjectId}
          onClick={onNewCodexSession}
          title="New Codex shell"
          aria-label="New Codex shell"
        >
          <Code2 size={13} />
          <span className="hidden sm:inline">Codex</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Open external terminal"
              aria-label="Open external terminal"
            >
              <Terminal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem onSelect={onOpenInGhostty} disabled={!ghosttyAvailable}>
              <MenuLogo className="border-accent/25 text-accent">
                <Ghost size={13} />
              </MenuLogo>
              <span>Open in Ghostty</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenInTerminalApp} disabled={!terminalAvailable}>
              <MenuLogo className="border-success/25 text-success">
                <Terminal size={13} />
              </MenuLogo>
              <span>Open in Terminal.app</span>
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
