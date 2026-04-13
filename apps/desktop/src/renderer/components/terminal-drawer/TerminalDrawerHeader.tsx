import type { GitHubIssueCacheRecord, PipelinePhase } from '@shipcode/shared';
import {
  Button,
  ChevronDown,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Maximize2,
  Minimize2,
  X,
} from '@shipcode/ui';

interface TerminalDrawerHeaderProps {
  currentModel: string | null;
  displayIssue: GitHubIssueCacheRecord | null;
  isMaximized: boolean;
  pipelinePhase: PipelinePhase;
  runningTabs: GitHubIssueCacheRecord[];
  startedAt: string | null;
  terminalThreadId: string | null;
  onOpenIssue: (issue: GitHubIssueCacheRecord) => void;
  onToggleMaximize: () => void;
  onToggleTerminal: () => void;
}

export function TerminalDrawerHeader({
  currentModel,
  displayIssue,
  isMaximized,
  pipelinePhase,
  runningTabs,
  startedAt,
  terminalThreadId,
  onOpenIssue,
  onToggleMaximize,
  onToggleTerminal,
}: TerminalDrawerHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0 gap-3 min-w-0">
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <span className="text-xs font-semibold text-secondary shrink-0">Terminal</span>
        {displayIssue && (
          <>
            <span className="text-muted text-xs shrink-0">·</span>
            {runningTabs.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal hover:bg-transparent"
                  >
                    <span className="font-mono text-muted">#{displayIssue.issueNumber}</span>
                    <span className="text-secondary truncate max-w-[240px]">
                      {displayIssue.title}
                    </span>
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
                className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal hover:bg-transparent"
                title={`Open issue detail for #${displayIssue.issueNumber}`}
              >
                <span className="font-mono text-muted">#{displayIssue.issueNumber}</span>
                <span className="text-secondary truncate hover:text-primary">
                  {displayIssue.title}
                </span>
              </Button>
            )}
          </>
        )}
        {pipelinePhase !== 'idle' && (
          <>
            <span className="text-muted text-xs shrink-0">·</span>
            <span className="text-xs text-accent font-medium shrink-0 capitalize">
              {pipelinePhase}
            </span>
          </>
        )}
        {currentModel && pipelinePhase !== 'idle' && (
          <>
            <span className="text-muted text-xs shrink-0">·</span>
            <span className="text-xs font-mono text-muted shrink-0 truncate max-w-[180px]">
              {currentModel}
            </span>
          </>
        )}
        {startedAt && (
          <>
            <span className="text-muted text-xs shrink-0">·</span>
            <span className="text-xs font-mono text-muted shrink-0">{startedAt}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore terminal' : 'Maximize terminal'}
          aria-label={isMaximized ? 'Restore terminal' : 'Maximize terminal'}
        >
          {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
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
