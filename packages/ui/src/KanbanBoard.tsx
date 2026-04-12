'use client';

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import type { GitHubIssueCacheRecord, IssuePipelineStatus } from '@shipcode/shared';
import { phaseToProgress } from '@shipcode/shared';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Columns3,
  ExternalLink,
  LayoutList,
  RefreshCw,
  RotateCcw,
  User,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { MODEL_DISPLAY } from './lib/model-display';
import { cn } from './lib/utils';
import { PhaseChip } from './PhaseChip';
import { Badge } from './primitives/badge';
import { Button } from './primitives/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './primitives/select';

// Static map for the drag overlay border. Tailwind's JIT needs string-literal
// class names, so we cannot interpolate (`border-${variant}`).
function dragOverlayBorderClass(status: IssuePipelineStatus): string {
  if (status === 'failed') return 'border-danger';
  if (status === 'awaiting_approval') return 'border-warning';
  return 'border-accent';
}

interface KanbanBoardProps {
  issues: GitHubIssueCacheRecord[];
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRefresh: () => void;
  onNewIssue?: () => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void;
  onRetry?: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  /** Per-project base branch that new worktrees fork from. */
  baseBranch?: string;
  /** Resolvable branch refs sourced from `git:list-branches`. */
  branches?: string[];
  /** Invoked when the user picks a new base branch from the toolbar Select. */
  onBaseBranchChange?: (branch: string) => void;
  /** Invoked when the user clicks the refresh button inside the branch dropdown. */
  onRefreshBranches?: () => void;
  /** Issue number currently open in the side panel — highlights the card. */
  selectedIssueNumber?: number;
  /** Project name shown as the toolbar heading (replaces the generic "GitHub Issues"). */
  projectName?: string;
  /** `https://github.com/owner/repo` — enables the "repo" quick-link. */
  repoUrl?: string | null;
  /** `https://github.com/owner/repo/projects` — enables the "board" quick-link. */
  projectsUrl?: string | null;
  /**
   * Optional interceptor for external link clicks. The Electron renderer passes
   * a handler that routes through `shell:open-external`; the web app leaves
   * this undefined and lets the browser follow the `<a href>`.
   */
  onOpenExternal?: (url: string) => void;
  /** Called when user clicks Archive on a single completed issue card. */
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  /** Called when user clicks Archive all in the Done column header. */
  onArchiveAllDone?: () => void;
}

type ColumnKey = 'todo' | 'agent' | 'human' | 'done';

type PhaseSection = {
  key: string;
  label: string;
  statuses: IssuePipelineStatus[];
  droppable: boolean;
  /**
   * Agent assigned to this phase. 'executor' is resolved per-issue from
   * `issue.executorModel`; everything else is hardcoded to match
   * packages/pipeline/src/pipeline.ts.
   */
  agent: 'claude' | 'codex' | 'executor';
};

type BoardColumn = {
  key: ColumnKey;
  label: string;
  statuses: IssuePipelineStatus[];
  droppable?: boolean;
  sections?: PhaseSection[];
};

const COLUMNS: BoardColumn[] = [
  {
    key: 'todo',
    label: 'Todo',
    droppable: true, // failed→todo retry lands here
    statuses: ['todo', 'queued'],
  },
  {
    key: 'agent',
    label: 'Agent Loop',
    statuses: ['planning', 'reviewing', 'revising', 'executing', 'verifying', 'shipping'],
    sections: [
      {
        key: 'planning',
        label: 'Planning',
        statuses: ['planning'],
        droppable: true,
        agent: 'claude',
      },
      {
        key: 'reviewing',
        label: 'Reviewing',
        statuses: ['reviewing', 'revising'],
        droppable: false,
        agent: 'codex',
      },
      {
        key: 'executing',
        label: 'Executing',
        statuses: ['executing'],
        droppable: false,
        agent: 'executor',
      },
      {
        key: 'verifying',
        label: 'Verifying',
        statuses: ['verifying', 'shipping'],
        droppable: false,
        agent: 'claude',
      },
    ],
  },
  {
    key: 'human',
    label: 'Human',
    statuses: ['awaiting_approval', 'failed'],
    sections: [
      {
        key: 'awaiting',
        label: 'Awaiting Approval',
        statuses: ['awaiting_approval'],
        droppable: false,
        agent: 'claude',
      },
      { key: 'failed', label: 'Failed', statuses: ['failed'], droppable: false, agent: 'claude' },
    ],
  },
  {
    key: 'done',
    label: 'Done',
    droppable: false,
    statuses: ['completed'],
  },
];

// Column header dot colors — matches GitHub Projects board defaults.
const COLUMN_DOT_CLASS: Record<ColumnKey, string> = {
  todo: 'bg-success',
  agent: 'bg-agent',
  human: 'bg-warning',
  done: 'bg-done',
};

// Only these statuses can be picked up and dragged.
const DRAGGABLE_STATUSES: IssuePipelineStatus[] = ['todo', 'queued', 'failed', 'awaiting_approval'];

// Statuses that are actively running in the pipeline — show a live indicator.
const ACTIVE_STATUSES: IssuePipelineStatus[] = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'verifying',
  'shipping',
];

// Statuses where "time in phase" is meaningful. Completed/failed are terminal,
// todo/queued haven't been picked up yet.
const PHASE_ELAPSED_STATUSES: IssuePipelineStatus[] = [
  'planning',
  'reviewing',
  'revising',
  'awaiting_approval',
  'executing',
  'verifying',
  'shipping',
];

function formatPhaseElapsed(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Live-ticking label showing how long a card has been in its current phase.
// Re-renders every second so the desktop app's Kanban view stays honest about
// how long work has been waiting on the agent.
function PhaseElapsed({ since }: { since: number }) {
  const [label, setLabel] = useState(() => formatPhaseElapsed(since));
  useEffect(() => {
    setLabel(formatPhaseElapsed(since));
    const id = setInterval(() => setLabel(formatPhaseElapsed(since)), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span className="font-mono tabular-nums text-[10px] text-muted">{label}</span>;
}

function DraggableCard({
  issue,
  onClick,
  onRerun,
  onArchiveIssue,
  isSelected,
  isRerunning,
}: {
  issue: GitHubIssueCacheRecord;
  onClick: () => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  isSelected?: boolean;
  isRerunning?: boolean;
}) {
  const draggable = DRAGGABLE_STATUSES.includes(issue.pipelineStatus);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !draggable,
  });

  const isFailed = issue.pipelineStatus === 'failed';
  const isAwaiting = issue.pipelineStatus === 'awaiting_approval';
  const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus);
  const showPhaseElapsed =
    PHASE_ELAPSED_STATUSES.includes(issue.pipelineStatus) && !!issue.lastPhaseUpdate;
  const phaseSince =
    showPhaseElapsed && issue.lastPhaseUpdate ? new Date(issue.lastPhaseUpdate).getTime() : 0;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's useDraggable provides keyboard accessibility via listeners/attributes spread below
    // biome-ignore lint/a11y/useKeyWithClickEvents: dnd-kit KeyboardSensor handles activation; the onClick only forwards selection on pointer click
    <div
      ref={setNodeRef}
      className={cn(
        'group relative rounded-md border bg-elevated p-2 transition-colors outline-none',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        isSelected && !isFailed && !isAwaiting && !isActive
          ? 'border-text-primary/60 bg-elevated'
          : !isSelected && !isActive
            ? 'border-border/50 hover:border-border-strong'
            : '',
        isFailed &&
          (isSelected
            ? 'border-danger bg-danger/[0.07]'
            : 'border-danger/40 bg-danger/[0.04] hover:border-danger/60'),
        isAwaiting &&
          (isSelected
            ? 'border-warning bg-warning/[0.07]'
            : 'border-warning/30 bg-warning/[0.03] hover:border-warning/50'),
        // Agent-active cards use the dedicated `--agent` yellow so they are
        // visually distinct from failed (red), awaiting (amber), and selected
        // (white). Lower opacity than failed/awaiting because agent work is
        // informational — the user is not being asked to act.
        isActive && 'shadow-[0_0_12px_rgba(56,189,248,0.18)]',
        isActive &&
          (isSelected
            ? 'border-agent/70 bg-agent/[0.06]'
            : 'border-agent/40 bg-agent/[0.03] hover:border-agent/60'),
        isDragging && 'opacity-50',
        !isDragging && issue.pipelineStatus === 'completed' && 'opacity-60',
      )}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {issue.pipelineStatus !== 'todo' && issue.pipelineStatus !== 'queued' && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-md overflow-hidden bg-agent/15">
          <div
            className={cn(
              'absolute h-full rounded-full transition-[width] duration-700 overflow-hidden',
              issue.pipelineStatus === 'completed'
                ? 'bg-success'
                : issue.pipelineStatus === 'awaiting_approval'
                  ? 'bg-warning'
                  : issue.pipelineStatus === 'failed'
                    ? 'bg-danger'
                    : 'bg-agent',
            )}
            style={{ width: `${phaseToProgress(issue.pipelineStatus)}%` }}
          >
            {issue.pipelineStatus !== 'completed' &&
              issue.pipelineStatus !== 'failed' &&
              issue.pipelineStatus !== 'awaiting_approval' && (
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-slide-progress" />
              )}
          </div>
        </div>
      )}
      {isFailed && onRerun && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-1.5 text-danger/60 hover:bg-danger/10 hover:text-danger"
          title="Re-run pipeline"
          disabled={isRerunning}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRerun(issue);
          }}
        >
          <RotateCcw size={14} className={isRerunning ? 'animate-spin' : ''} />
        </Button>
      )}
      {issue.pipelineStatus === 'completed' && onArchiveIssue && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-1.5 text-muted/60 hover:bg-muted/10 hover:text-muted opacity-0 group-hover:opacity-100 transition-opacity"
          title="Archive issue"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onArchiveIssue(issue);
          }}
        >
          <Archive size={14} />
        </Button>
      )}
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] text-secondary font-mono">#{issue.issueNumber}</span>
        {showPhaseElapsed && (
          <span className="flex items-center gap-1.5">
            <span className="font-mono tabular-nums text-[10px] text-muted">
              {phaseToProgress(issue.pipelineStatus)}%
            </span>
            <PhaseElapsed since={phaseSince} />
          </span>
        )}
      </div>
      <div className="text-xs leading-snug text-primary font-medium line-clamp-2">
        {issue.title}
      </div>
      <div className="flex flex-wrap gap-1 mt-1 items-center">
        {issue.labels
          .filter((l) => l.startsWith('agent:'))
          .map((l) => (
            <Badge key={l} variant="accent" className="text-[10px] px-1.5 py-px font-medium">
              {l}
            </Badge>
          ))}
        <PhaseChip status={issue.pipelineStatus} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            className={cn(
              'h-5 px-1.5 text-[10px] font-medium opacity-0 transition-all group-hover:opacity-100 hover:bg-elevated',
              isFailed
                ? 'text-danger/60 hover:text-danger'
                : isAwaiting
                  ? 'text-warning/60 hover:text-warning'
                  : isActive
                    ? 'text-agent/60 hover:text-agent'
                    : 'text-muted hover:text-primary',
            )}
            title="Open issue detail"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            View
          </Button>
        </div>
      </div>
    </div>
  );
}

function DroppableColumn({
  id,
  columnKey,
  label,
  issues,
  droppable,
  onIssueClick,
  selectedIssueNumber,
  onArchiveAllDone,
  onArchiveIssue,
}: {
  id: string;
  columnKey: ColumnKey;
  label: string;
  issues: GitHubIssueCacheRecord[];
  droppable: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  selectedIssueNumber?: number;
  onArchiveAllDone?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 min-w-[140px] max-w-[220px] flex flex-col bg-secondary rounded-md overflow-hidden transition-colors border border-border/40',
        isOver && droppable && 'ring-2 ring-accent bg-tertiary',
      )}
    >
      <div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary border-b border-border shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full shrink-0', COLUMN_DOT_CLASS[columnKey])} />
          {label}
        </span>
        <div className="flex items-center gap-1">
          {onArchiveAllDone && issues.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted/60 hover:text-muted hover:bg-muted/10"
              title="Archive all done issues"
              onClick={onArchiveAllDone}
            >
              <Archive size={12} />
            </Button>
          )}
          <span className="text-[10px] bg-tertiary text-muted min-w-[18px] text-center px-1.5 py-px rounded-full font-medium">
            {issues.length}
          </span>
        </div>
      </div>
      <div
        className={cn(
          'flex-1 overflow-y-auto p-1.5 flex flex-col gap-1 min-h-[60px]',
          columnKey === 'done' && 'opacity-60',
        )}
      >
        {issues.map((issue) => (
          <DraggableCard
            key={issue.id}
            issue={issue}
            onClick={() => onIssueClick(issue)}
            isSelected={issue.issueNumber === selectedIssueNumber}
            onArchiveIssue={onArchiveIssue}
          />
        ))}
      </div>
    </div>
  );
}

function SectionBlock({
  columnKey,
  section,
  issues,
  onIssueClick,
  onRerun,
  selectedIssueNumber,
  rerunningId,
}: {
  columnKey: ColumnKey;
  section: PhaseSection;
  issues: GitHubIssueCacheRecord[];
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${columnKey}:${section.key}`,
    disabled: !section.droppable,
  });
  const count = issues.length;
  const empty = count === 0;
  // Only the Agent Loop column shows agent badges. Human/Failed/Done skip them.
  const showAgent = columnKey === 'agent';
  // For the executor row, resolve per-issue from the first card; when empty, default.
  const agentLabel =
    section.agent === 'executor' ? (issues[0]?.executorModel ?? 'claude') : section.agent;

  // Tone highlights non-empty sections so they pull the eye.
  // Stays null when the section is empty to avoid false alarms.
  const tone: 'danger' | 'warning' | 'agent' | null =
    section.key === 'failed' && !empty
      ? 'danger'
      : section.key === 'awaiting' && !empty
        ? 'warning'
        : columnKey === 'agent' && !empty
          ? 'agent'
          : null;

  return (
    <div className="border-t border-border first:border-t-0">
      <div
        className={cn(
          'flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
          empty && 'text-muted opacity-50',
          !empty && !tone && 'text-secondary',
          tone === 'agent' && 'text-agent',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        <span className="flex items-center gap-1.5">
          <span>{section.label}</span>
          {showAgent && (
            <span className="font-mono normal-case text-[9px] font-normal text-muted">
              · {MODEL_DISPLAY[agentLabel] ?? agentLabel}
            </span>
          )}
        </span>
        <span
          className={cn(
            // Always reserve a 1px border so the pill size doesn't shift when the
            // tone switches on/off as issues enter/leave the section.
            'text-[10px] bg-tertiary min-w-[18px] text-center px-1.5 py-px rounded-full font-medium border border-transparent',
            empty && 'text-muted/70',
            !empty && !tone && 'text-muted',
            tone === 'agent' && 'bg-agent/15 text-agent border-agent/25',
            tone === 'danger' && 'bg-danger/15 text-danger border-danger/25',
            tone === 'warning' && 'bg-warning/15 text-warning border-warning/25',
          )}
        >
          {count}
        </span>
      </div>
      {!empty && (
        <div
          ref={section.droppable ? setNodeRef : undefined}
          className={cn(
            'flex flex-col gap-1 p-1.5 pt-0',
            section.droppable &&
              isOver &&
              'bg-tertiary border border-dashed border-accent rounded-md',
          )}
        >
          {issues.map((issue) => (
            <DraggableCard
              key={issue.id}
              issue={issue}
              onClick={() => onIssueClick(issue)}
              onRerun={onRerun}
              isSelected={issue.issueNumber === selectedIssueNumber}
              isRerunning={issue.id === rerunningId}
            />
          ))}
        </div>
      )}
      {empty && section.droppable && (
        <div
          ref={setNodeRef}
          className={cn(
            'mx-1.5 mb-1.5 min-h-[36px] rounded border border-dashed',
            isOver ? 'border-accent bg-tertiary' : 'border-border/50',
          )}
        />
      )}
    </div>
  );
}

function StackedColumn({
  column,
  issues,
  onIssueClick,
  onRerun,
  selectedIssueNumber,
  rerunningId,
}: {
  column: BoardColumn;
  issues: GitHubIssueCacheRecord[];
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
}) {
  const columnIssues = issues.filter((i) => column.statuses.includes(i.pipelineStatus));

  return (
    <div className="flex-[1.3] min-w-[180px] max-w-[280px] flex flex-col bg-secondary rounded-md overflow-hidden border border-border/40">
      <div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary border-b border-border shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full shrink-0', COLUMN_DOT_CLASS[column.key])} />
          {column.label}
        </span>
        <span className="text-[10px] bg-tertiary text-muted min-w-[18px] text-center px-1.5 py-px rounded-full font-medium">
          {columnIssues.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-[60px]">
        {(column.sections ?? []).map((section) => {
          const sectionIssues = columnIssues.filter((i) =>
            section.statuses.includes(i.pipelineStatus),
          );
          return (
            <SectionBlock
              key={section.key}
              columnKey={column.key}
              section={section}
              issues={sectionIssues}
              onIssueClick={onIssueClick}
              onRerun={onRerun}
              selectedIssueNumber={selectedIssueNumber}
              rerunningId={rerunningId}
            />
          );
        })}
      </div>
    </div>
  );
}

// Custom collision detection: prefer whatever droppable the user's pointer is
// actually over (most intuitive for multi-column kanban), and fall back to
// rectangle intersection when the pointer is in a gap between columns.
// `closestCorners` was the prior default but it can pick a farther column as
// "closest" when you drag across the middle of a wide layout, which caused
// drag-to-Todo from Human to silently land on Agent Loop / Planning.
const customCollisionDetection: CollisionDetection = (args: Parameters<CollisionDetection>[0]) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

// ─── List view ───────────────────────────────────────────────────────────────
//
// The list view mirrors the Kanban's column/section structure so users get the
// same per-phase breakdown (Planning / Reviewing / Executing / Verifying) with
// model labels and the yellow `agent` tone on active rows — instead of a flat
// "In Progress" bucket. COLUMNS is the single source of truth for both views.

// Display override: "Agent Loop" reads as "In Progress" at the list level.
const LIST_COLUMN_LABEL: Record<ColumnKey, string> = {
  todo: 'Todo',
  agent: 'In Progress',
  human: 'Needs Attention',
  done: 'Done',
};

// Group-level drop targets. Only Todo + Agent Loop accept drops; mapping to the
// ids `handleDragEnd` recognizes lets the existing transitions still fire from
// the list view without touching pipeline code.
const LIST_COLUMN_DROP_ID: Partial<Record<ColumnKey, string>> = {
  todo: 'todo', // failed → todo (retry)
  agent: 'agent:planning', // todo|failed → agent:planning (start/rerun)
};

type RowTone = 'default' | 'agent' | 'danger' | 'warning';

function rowToneFor(status: IssuePipelineStatus): RowTone {
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_approval') return 'warning';
  if (ACTIVE_STATUSES.includes(status)) return 'agent';
  return 'default';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface DraggableListRowProps {
  issue: GitHubIssueCacheRecord;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
}

function DraggableListRow({
  issue,
  selectedIssueNumber,
  activeId,
  onIssueClick,
  onArchiveIssue,
}: DraggableListRowProps) {
  const isDraggable = DRAGGABLE_STATUSES.includes(issue.pipelineStatus);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !isDraggable,
  });
  const isSelected = selectedIssueNumber === issue.issueNumber;
  const tone = rowToneFor(issue.pipelineStatus);
  const isActive = tone === 'agent';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's useDraggable provides keyboard accessibility via listeners/attributes spread below
    // biome-ignore lint/a11y/useKeyWithClickEvents: dnd-kit KeyboardSensor handles activation; the onClick only forwards selection on pointer click
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center gap-3 w-full text-left pl-3 pr-3 py-2 rounded-md border-l-2 transition-colors text-sm',
        tone === 'default' &&
          (isSelected
            ? 'border-transparent bg-accent/10 text-primary'
            : 'border-transparent hover:bg-secondary text-primary'),
        tone === 'agent' &&
          (isSelected
            ? 'border-agent bg-agent/[0.08] text-primary'
            : 'border-agent/60 bg-agent/[0.03] hover:bg-agent/[0.06] text-primary'),
        tone === 'danger' &&
          (isSelected
            ? 'border-danger bg-danger/[0.08] text-primary'
            : 'border-danger/60 bg-danger/[0.03] hover:bg-danger/[0.06] text-primary'),
        tone === 'warning' &&
          (isSelected
            ? 'border-warning bg-warning/[0.08] text-primary'
            : 'border-warning/60 bg-warning/[0.03] hover:bg-warning/[0.06] text-primary'),
        isDragging ? 'opacity-40' : '',
        !isDragging && issue.pipelineStatus === 'completed' && 'opacity-60',
        isDraggable ? 'cursor-grab' : 'cursor-pointer',
        activeId && activeId !== issue.id ? 'pointer-events-none' : '',
      )}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      onClick={!isDragging ? () => onIssueClick(issue) : undefined}
    >
      {isActive ? (
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-agent" />
        </span>
      ) : (
        <span
          className={cn(
            'w-2 h-2 rounded-full shrink-0',
            tone === 'danger' && 'bg-danger',
            tone === 'warning' && 'bg-warning',
            tone === 'default' &&
              (issue.pipelineStatus === 'completed' ? 'bg-done' : 'bg-text-muted'),
          )}
        />
      )}
      <span className="font-mono text-xs text-secondary shrink-0">#{issue.issueNumber}</span>
      <span className="flex-1 truncate">{issue.title}</span>
      <span className="shrink-0 text-secondary text-xs flex items-center gap-1">
        <User size={11} className="text-muted" />
        {issue.assignee ?? '—'}
      </span>
      <span className="shrink-0 text-muted text-xs">{formatDate(issue.fetchedAt)}</span>
      {issue.pipelineStatus === 'completed' && onArchiveIssue && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted/50 hover:text-muted hover:bg-muted/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Archive issue"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onArchiveIssue(issue);
          }}
        >
          <Archive size={12} />
        </Button>
      )}
    </div>
  );
}

interface ListSectionBlockProps {
  columnKey: ColumnKey;
  section: PhaseSection;
  issues: GitHubIssueCacheRecord[];
  allIssues: GitHubIssueCacheRecord[];
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
}

function ListSectionBlock({
  columnKey,
  section,
  issues,
  allIssues,
  selectedIssueNumber,
  activeId,
  onIssueClick,
}: ListSectionBlockProps) {
  const count = issues.length;
  const empty = count === 0;
  const showAgent = columnKey === 'agent';
  // Resolve executor per-issue; when the section is empty, fall back to any
  // active thread's executor so the header still reads correctly, then default.
  const agentLabel =
    section.agent === 'executor'
      ? (issues[0]?.executorModel ??
        allIssues.find((i) => i.pipelineStatus === 'executing')?.executorModel ??
        'claude')
      : section.agent;

  const tone: 'danger' | 'warning' | 'agent' | null =
    section.key === 'failed' && !empty
      ? 'danger'
      : section.key === 'awaiting' && !empty
        ? 'warning'
        : columnKey === 'agent' && !empty
          ? 'agent'
          : null;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide',
          empty && 'text-muted opacity-50',
          !empty && !tone && 'text-secondary',
          tone === 'agent' && 'text-agent',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        <span>{section.label}</span>
        {showAgent && (
          <span className="font-mono normal-case text-[9px] font-normal text-muted">
            · {MODEL_DISPLAY[agentLabel] ?? agentLabel}
          </span>
        )}
        <span
          className={cn(
            'ml-1 text-[10px] bg-tertiary min-w-[18px] text-center px-1.5 py-px rounded-full font-medium border border-transparent',
            empty && 'text-muted/70',
            !empty && !tone && 'text-muted',
            tone === 'agent' && 'bg-agent/15 text-agent border-agent/25',
            tone === 'danger' && 'bg-danger/15 text-danger border-danger/25',
            tone === 'warning' && 'bg-warning/15 text-warning border-warning/25',
          )}
        >
          {count}
        </span>
      </div>
      {!empty && (
        <div className="flex flex-col gap-0.5">
          {issues.map((issue) => (
            <DraggableListRow
              key={issue.id}
              issue={issue}
              selectedIssueNumber={selectedIssueNumber}
              activeId={activeId}
              onIssueClick={onIssueClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DroppableListGroupProps {
  dropId?: string;
  children: ReactNode;
}

function DroppableListGroup({ dropId, children }: DroppableListGroupProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? '__noop__', disabled: !dropId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-0.5 rounded-md transition-colors min-h-[2rem]',
        dropId && isOver ? 'bg-accent/5 ring-1 ring-accent/20' : '',
      )}
    >
      {children}
    </div>
  );
}

interface IssueListViewProps {
  issues: GitHubIssueCacheRecord[];
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onArchiveAllDone?: () => void;
}

function IssueListView({
  issues,
  selectedIssueNumber,
  activeId,
  onIssueClick,
  onArchiveIssue,
  onArchiveAllDone,
}: IssueListViewProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      {COLUMNS.map((col) => {
        const label = LIST_COLUMN_LABEL[col.key];
        const columnIssues = issues.filter((i) => col.statuses.includes(i.pipelineStatus));
        const isCollapsed = collapsed[col.key] ?? false;
        const dropId = LIST_COLUMN_DROP_ID[col.key];
        return (
          <div key={col.key}>
            <div className="mb-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto flex-1 justify-start gap-2 px-0 text-xs font-semibold uppercase tracking-wider text-secondary hover:bg-transparent hover:text-primary"
                onClick={() => toggle(col.key)}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className={cn('w-2 h-2 rounded-full shrink-0', COLUMN_DOT_CLASS[col.key])} />
                {label}
                <span className="text-muted font-normal normal-case tracking-normal ml-0.5">
                  ({columnIssues.length})
                </span>
              </Button>
              {col.key === 'done' && onArchiveAllDone && columnIssues.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted/60 hover:text-muted hover:bg-muted/10"
                  title="Archive all done issues"
                  onClick={onArchiveAllDone}
                >
                  <Archive size={12} />
                </Button>
              )}
            </div>
            {!isCollapsed && (
              <DroppableListGroup dropId={dropId}>
                {col.sections ? (
                  <div className="flex flex-col gap-2">
                    {col.sections.map((section) => (
                      <ListSectionBlock
                        key={section.key}
                        columnKey={col.key}
                        section={section}
                        issues={columnIssues.filter((i) =>
                          section.statuses.includes(i.pipelineStatus),
                        )}
                        allIssues={issues}
                        selectedIssueNumber={selectedIssueNumber}
                        activeId={activeId}
                        onIssueClick={onIssueClick}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {columnIssues.map((issue) => (
                      <DraggableListRow
                        key={issue.id}
                        issue={issue}
                        selectedIssueNumber={selectedIssueNumber}
                        activeId={activeId}
                        onIssueClick={onIssueClick}
                        onArchiveIssue={col.key === 'done' ? onArchiveIssue : undefined}
                      />
                    ))}
                    {columnIssues.length === 0 && (
                      <p className="text-xs text-muted pl-2 py-1">No issues</p>
                    )}
                  </>
                )}
              </DroppableListGroup>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function KanbanBoard({
  issues,
  onIssueClick,
  onRefresh,
  onNewIssue,
  onStartPipeline,
  onRetry,
  onRerun,
  baseBranch,
  branches,
  onBaseBranchChange,
  onRefreshBranches,
  selectedIssueNumber,
  projectName,
  repoUrl,
  projectsUrl,
  onOpenExternal,
  onArchiveIssue,
  onArchiveAllDone,
}: KanbanBoardProps) {
  const handleExternalClick = (url: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onOpenExternal) {
      e.preventDefault();
      onOpenExternal(url);
    }
  };
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIssue = issues.find((i) => i.id === activeId);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [refreshing, setRefreshing] = useState(false);
  const [showRefreshToast, setShowRefreshToast] = useState(false);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const handleRerun = useCallback(
    (issue: GitHubIssueCacheRecord) => {
      setRerunningId(issue.id);
      onRerun?.(issue);
      setTimeout(() => setRerunningId(null), 800);
    },
    [onRerun],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setShowRefreshToast(true);
    onRefresh();
    // Keep the spin for at least 600ms so it's visible
    setTimeout(() => setRefreshing(false), 600);
  }, [onRefresh]);

  useEffect(() => {
    if (!showRefreshToast) return;
    const id = setTimeout(() => setShowRefreshToast(false), 2000);
    return () => clearTimeout(id);
  }, [showRefreshToast]);

  function getColumnForIssue(issue: GitHubIssueCacheRecord): ColumnKey {
    return COLUMNS.find((c) => c.statuses.includes(issue.pipelineStatus))?.key ?? 'todo';
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !active.data.current) return;

    const issue = active.data.current as GitHubIssueCacheRecord;
    const sourceColumn = getColumnForIssue(issue);
    const dropId = String(over.id);

    // Only these transitions are allowed:
    // 1. todo → agent:planning (start pipeline)
    if (sourceColumn === 'todo' && dropId === 'agent:planning' && onStartPipeline) {
      onStartPipeline(issue);
      return;
    }
    // 2. failed → agent:planning (re-run directly from failed)
    if (
      sourceColumn === 'human' &&
      dropId === 'agent:planning' &&
      issue.pipelineStatus === 'failed' &&
      (onRerun ?? onStartPipeline)
    ) {
      (onRerun ?? onStartPipeline)?.(issue);
      return;
    }
    // 3. human → todo (reset failed or awaiting_approval back to todo)
    if (
      sourceColumn === 'human' &&
      dropId === 'todo' &&
      (issue.pipelineStatus === 'failed' || issue.pipelineStatus === 'awaiting_approval') &&
      onRetry
    ) {
      onRetry(issue);
      return;
    }
    // All other drops: no-op (snap back)
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="flex items-center px-4 py-3 border-b border-border shrink-0 gap-3">
        <h3 className="text-sm font-semibold shrink-0 truncate">
          {projectName ?? 'GitHub Issues'}
        </h3>
        {(repoUrl || projectsUrl) && (
          <div className="flex items-center gap-1 shrink-0">
            {repoUrl && (
              <Button asChild variant="outline" size="xs" title="Open repository on github.com">
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={handleExternalClick(repoUrl)}
                >
                  repo
                  <ExternalLink size={10} />
                </a>
              </Button>
            )}
            {projectsUrl && (
              <Button asChild variant="outline" size="xs" title="Open Projects board on github.com">
                <a
                  href={projectsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={handleExternalClick(projectsUrl)}
                >
                  board
                  <ExternalLink size={10} />
                </a>
              </Button>
            )}
          </div>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          {baseBranch && branches && branches.length > 0 && onBaseBranchChange && (
            <div className="flex items-center border border-border rounded-md overflow-hidden min-w-0 max-w-[240px] shrink-0">
              <Select value={baseBranch} onValueChange={onBaseBranchChange}>
                <SelectTrigger className="h-7 gap-1 rounded-none border-0 bg-transparent px-2 text-xs font-mono text-secondary hover:text-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const local = branches.filter((b) => !b.includes('/'));
                    const remote = branches.filter((b) => b.includes('/'));
                    return (
                      <>
                        {local.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Local</SelectLabel>
                            {local.map((b) => (
                              <SelectItem key={b} value={b} className="text-xs font-mono">
                                {b}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {local.length > 0 && remote.length > 0 && <SelectSeparator />}
                        {remote.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Remote</SelectLabel>
                            {remote.map((b) => (
                              <SelectItem key={b} value={b} className="text-xs font-mono">
                                {b}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
              {onRefreshBranches && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-none border-l border-border"
                  title="Refresh branches"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshBranches();
                  }}
                >
                  <RefreshCw size={14} />
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center border border-border rounded-md overflow-hidden shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'rounded-none text-muted',
                view === 'list' && 'bg-accent/15 text-accent',
              )}
              onClick={() => setView('list')}
              title="List view"
            >
              <LayoutList size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'rounded-none border-l border-border text-muted',
                view === 'kanban' && 'bg-accent/15 text-accent',
              )}
              onClick={() => setView('kanban')}
              title="Board view"
            >
              <Columns3 size={14} />
            </Button>
          </div>
          <Button variant="outline" size="icon-sm" onClick={handleRefresh} title="Refresh board">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </Button>
          {onNewIssue && (
            <Button size="sm" onClick={onNewIssue}>
              + New PRD
            </Button>
          )}
        </div>
      </div>
      <DndContext
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {view === 'list' && (
          <IssueListView
            issues={issues}
            selectedIssueNumber={selectedIssueNumber}
            activeId={activeId}
            onIssueClick={onIssueClick}
            onArchiveIssue={onArchiveIssue}
            onArchiveAllDone={onArchiveAllDone}
          />
        )}
        {view === 'kanban' && (
          <div className="flex flex-1 overflow-x-auto overflow-y-hidden gap-0.5 p-3 px-2">
            {COLUMNS.map((col) => {
              if (col.sections) {
                return (
                  <StackedColumn
                    key={col.key}
                    column={col}
                    issues={issues}
                    onIssueClick={onIssueClick}
                    onRerun={handleRerun}
                    rerunningId={rerunningId}
                    selectedIssueNumber={selectedIssueNumber}
                  />
                );
              }
              const columnIssues = issues.filter((i) => col.statuses.includes(i.pipelineStatus));
              return (
                <DroppableColumn
                  key={col.key}
                  id={col.key}
                  columnKey={col.key}
                  label={col.label}
                  issues={columnIssues}
                  droppable={!!col.droppable}
                  onIssueClick={onIssueClick}
                  selectedIssueNumber={selectedIssueNumber}
                  onArchiveAllDone={col.key === 'done' ? onArchiveAllDone : undefined}
                  onArchiveIssue={col.key === 'done' ? onArchiveIssue : undefined}
                />
              );
            })}
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {activeIssue ? (
            <div
              className={cn(
                'opacity-80 bg-secondary border rounded-md p-2 shadow-lg cursor-grabbing',
                dragOverlayBorderClass(activeIssue.pipelineStatus),
              )}
            >
              <div className="text-[11px] text-muted font-mono mb-0.5">
                #{activeIssue.issueNumber}
              </div>
              <div className="text-xs leading-snug text-primary line-clamp-2">
                {activeIssue.title}
              </div>
              <div className="flex flex-wrap gap-1 mt-1 items-center">
                <PhaseChip status={activeIssue.pipelineStatus} />
                <div className="ml-auto h-5" />
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {showRefreshToast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg text-xs text-secondary">
            <RefreshCw size={12} className="text-muted" />
            Board refreshed
          </div>
        </div>
      )}
    </div>
  );
}
