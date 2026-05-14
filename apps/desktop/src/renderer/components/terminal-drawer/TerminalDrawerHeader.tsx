import { PIPELINE_PHASE, type PipelinePhase } from '@shipcode/shared';
import { PhaseChip, Tooltip, TooltipContent, TooltipTrigger } from '@shipcode/ui';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipshitdev/ui';
import { ChevronDown, ChevronUp, Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TerminalDrawerTarget } from './constants';

interface TerminalHeaderIconButtonProps {
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  tooltip: string;
  onClick: () => void;
}

function TerminalHeaderIconButton({
  ariaLabel,
  children,
  disabled = false,
  tooltip,
  onClick,
}: TerminalHeaderIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:bg-hover/70 hover:text-primary"
            disabled={disabled}
            onClick={onClick}
            aria-label={ariaLabel}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface TerminalDrawerHeaderProps {
  activeProjectId: string | null;
  approvedAwaitingExecution?: boolean;
  currentModel: string | null;
  displayTarget: TerminalDrawerTarget | null;
  isMaximized: boolean;
  isMinimized: boolean;
  pipelinePhase: PipelinePhase;
  runningTargets: TerminalDrawerTarget[];
  startedAt: string | null;
  terminalThreadId: string | null;
  onOpenProjectTerminal: () => void;
  onOpenTarget: (target: TerminalDrawerTarget) => void;
  onResetHeight: () => void;
  onToggleMinimized: () => void;
  onToggleMaximize: () => void;
  onToggleTerminal: () => void;
}

export function TerminalDrawerHeader({
  activeProjectId,
  approvedAwaitingExecution = false,
  currentModel,
  displayTarget,
  isMaximized,
  isMinimized,
  pipelinePhase,
  runningTargets,
  startedAt,
  terminalThreadId,
  onOpenProjectTerminal,
  onOpenTarget,
  onResetHeight,
  onToggleMinimized,
  onToggleMaximize,
  onToggleTerminal,
}: TerminalDrawerHeaderProps) {
  const maximizeLabel = isMaximized ? 'Minimize terminal to window' : 'Maximize terminal';
  const oneLineLabel = isMinimized ? 'Restore terminal drawer' : 'Minimize terminal to one line';

  return (
    <div className="flex items-center justify-between border-b border-border bg-secondary/90 px-4 py-1.5 shrink-0 gap-3 min-w-0">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {displayTarget &&
            (runningTargets.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal text-secondary hover:bg-transparent hover:text-primary"
                  >
                    <span className="font-mono text-muted-foreground">{displayTarget.label}</span>
                    <span className="truncate max-w-[240px]">{displayTarget.title}</span>
                    <ChevronDown size={11} className="text-muted-foreground shrink-0" />
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
                      <span className="font-mono text-muted-foreground text-xs">
                        {target.label}
                      </span>
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
                <span className="font-mono text-muted-foreground">{displayTarget.label}</span>
                <span className="truncate hover:text-primary">{displayTarget.title}</span>
              </Button>
            ) : (
              <div className="flex h-auto min-w-0 items-center gap-1.5 px-1 py-0 text-xs font-normal text-secondary">
                <span className="font-mono text-muted-foreground">{displayTarget.label}</span>
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
            <span className="text-xs font-mono text-muted-foreground shrink-0 truncate max-w-[180px]">
              {currentModel}
            </span>
          )}

          {startedAt && (
            <span className="text-xs font-mono text-muted-foreground shrink-0">{startedAt}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <TerminalHeaderIconButton
          disabled={!activeProjectId}
          onClick={onOpenProjectTerminal}
          tooltip="Open Terminal"
          ariaLabel="Open Terminal"
        >
          <Plus size={14} />
        </TerminalHeaderIconButton>

        {!isMinimized && (
          <TerminalHeaderIconButton
            onClick={onToggleMaximize}
            tooltip={maximizeLabel}
            ariaLabel={maximizeLabel}
          >
            {isMaximized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </TerminalHeaderIconButton>
        )}

        <TerminalHeaderIconButton
          onClick={isMinimized ? onToggleMinimized : onResetHeight}
          tooltip={isMinimized ? oneLineLabel : 'Reset terminal size'}
          ariaLabel={isMinimized ? oneLineLabel : 'Reset terminal size'}
        >
          <RotateCcw size={13} />
        </TerminalHeaderIconButton>

        {!isMinimized && (
          <TerminalHeaderIconButton
            onClick={onToggleMinimized}
            tooltip={oneLineLabel}
            ariaLabel={oneLineLabel}
          >
            <Minus size={14} />
          </TerminalHeaderIconButton>
        )}

        <TerminalHeaderIconButton
          onClick={onToggleTerminal}
          tooltip="Close terminal"
          ariaLabel="Close terminal"
        >
          <X size={14} />
        </TerminalHeaderIconButton>
      </div>
    </div>
  );
}
