import { PIPELINE_PHASE, type PipelinePhase } from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipshitdev/ui';
import { ChevronDown, ChevronUp, Terminal, X } from 'lucide-react';
import type { TerminalDrawerTarget } from './constants';

interface TerminalDrawerHeaderProps {
  activeProjectId: string | null;
  approvedAwaitingExecution?: boolean;
  currentModel: string | null;
  displayTarget: TerminalDrawerTarget | null;
  isMaximized: boolean;
  pipelinePhase: PipelinePhase;
  runningTargets: TerminalDrawerTarget[];
  startedAt: string | null;
  terminalThreadId: string | null;
  onOpenProjectTerminal: () => void;
  onOpenTarget: (target: TerminalDrawerTarget) => void;
  onToggleMaximize: () => void;
  onToggleTerminal: () => void;
}

export function TerminalDrawerHeader({
  activeProjectId,
  approvedAwaitingExecution = false,
  currentModel,
  displayTarget,
  isMaximized,
  pipelinePhase,
  runningTargets,
  startedAt,
  terminalThreadId,
  onOpenProjectTerminal,
  onOpenTarget,
  onToggleMaximize,
  onToggleTerminal,
}: TerminalDrawerHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-primary/75 px-4 py-1.5 shrink-0 gap-3 min-w-0">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <div className="shrink-0">
          <span className="rounded-md bg-tertiary px-3 py-1 text-[11px] font-medium text-primary">
            Console
          </span>
        </div>

        <div className="flex items-center gap-2 min-w-0 overflow-hidden border-l border-border pl-3">
          {displayTarget &&
            (runningTargets.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal text-secondary hover:bg-transparent hover:text-primary"
                  >
                    <span className="font-mono text-muted">{displayTarget.label}</span>
                    <span className="truncate max-w-[240px]">{displayTarget.title}</span>
                    <ChevronDown size={11} className="text-muted shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  {runningTargets.map((target) => (
                    <DropdownMenuItem
                      key={target.threadId}
                      onSelect={() => onOpenTarget(target)}
                      className={cn(
                        target.threadId === terminalThreadId && 'bg-hover text-primary',
                      )}
                    >
                      <span className="font-mono text-muted text-xs">{target.label}</span>
                      <span className="truncate max-w-[280px]">{target.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : displayTarget.kind === 'issue' ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onOpenTarget(displayTarget)}
                className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal text-secondary hover:bg-transparent hover:text-primary"
                title={`Open issue detail for ${displayTarget.label}`}
              >
                <span className="font-mono text-muted">{displayTarget.label}</span>
                <span className="truncate hover:text-primary">{displayTarget.title}</span>
              </Button>
            ) : (
              <div className="flex h-auto min-w-0 items-center gap-1.5 px-1 py-0 text-xs font-normal text-secondary">
                <span className="font-mono text-muted">{displayTarget.label}</span>
                <span className="truncate">{displayTarget.title}</span>
              </div>
            ))}

          {pipelinePhase !== PIPELINE_PHASE.idle && (
            <PhaseChip
              status={pipelinePhase}
              label={approvedAwaitingExecution ? 'Waiting for slot' : undefined}
              className={cn(
                'shrink-0',
                approvedAwaitingExecution && 'border-agent/25 bg-agent/10 text-agent',
              )}
            />
          )}

          {currentModel && pipelinePhase !== PIPELINE_PHASE.idle && (
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
          className="h-6 gap-1 px-2"
          disabled={!activeProjectId}
          onClick={onOpenProjectTerminal}
          title="Open Terminal"
          aria-label="Open Terminal"
        >
          <Terminal size={13} />
          <span className="hidden sm:inline">Terminal</span>
        </Button>

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
