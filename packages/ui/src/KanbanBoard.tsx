import { useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { DndContext, DragOverlay, pointerWithin, rectIntersection, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import type { GitHubIssueCacheRecord, IssuePipelineStatus } from '@shipcode/shared'
import { cn } from './lib/utils'
import { getStatusBadgeVariant } from './lib/status-variant'
import { Badge } from './primitives/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select'

const MODEL_DISPLAY: Record<string, string> = {
	claude: 'sonnet 4.6',
	codex: 'gpt 5.4',
	openrouter: 'openrouter',
}

// Static map for the drag overlay border. Tailwind's JIT needs string-literal
// class names, so we cannot interpolate (`border-${variant}`).
function dragOverlayBorderClass(status: IssuePipelineStatus): string {
	if (status === 'failed') return 'border-danger'
	if (status === 'awaiting_approval') return 'border-warning'
	return 'border-accent'
}

interface KanbanBoardProps {
	issues: GitHubIssueCacheRecord[]
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	onRefresh: () => void
	onNewIssue?: () => void
	onStartPipeline?: (issue: GitHubIssueCacheRecord) => void
	onRetry?: (issue: GitHubIssueCacheRecord) => void
	onRerun?: (issue: GitHubIssueCacheRecord) => void
	/** Per-project base branch that new worktrees fork from. */
	baseBranch?: string
	/** Resolvable branch refs sourced from `git:list-branches`. */
	branches?: string[]
	/** Invoked when the user picks a new base branch from the toolbar Select. */
	onBaseBranchChange?: (branch: string) => void
	/** Issue number currently open in the side panel — highlights the card. */
	selectedIssueNumber?: number
}

type ColumnKey = 'todo' | 'agent' | 'human' | 'done'

type PhaseSection = {
	key: string
	label: string
	statuses: IssuePipelineStatus[]
	droppable: boolean
	/**
	 * Agent assigned to this phase. 'executor' is resolved per-issue from
	 * `issue.executorModel`; everything else is hardcoded to match
	 * packages/pipeline/src/pipeline.ts.
	 */
	agent: 'claude' | 'codex' | 'executor'
}

type BoardColumn = {
	key: ColumnKey
	label: string
	statuses: IssuePipelineStatus[]
	droppable?: boolean
	sections?: PhaseSection[]
}

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
			{ key: 'planning', label: 'Planning', statuses: ['planning'], droppable: true, agent: 'claude' },
			{ key: 'reviewing', label: 'Reviewing', statuses: ['reviewing', 'revising'], droppable: false, agent: 'codex' },
			{ key: 'executing', label: 'Executing', statuses: ['executing'], droppable: false, agent: 'executor' },
			{ key: 'verifying', label: 'Verifying', statuses: ['verifying', 'shipping'], droppable: false, agent: 'claude' },
		],
	},
	{
		key: 'human',
		label: 'Human',
		statuses: ['awaiting_approval', 'failed'],
		sections: [
			{ key: 'awaiting', label: 'Awaiting Approval', statuses: ['awaiting_approval'], droppable: false, agent: 'claude' },
			{ key: 'failed', label: 'Failed', statuses: ['failed'], droppable: false, agent: 'claude' },
		],
	},
	{
		key: 'done',
		label: 'Done',
		droppable: false,
		statuses: ['completed'],
	},
]

// Only these statuses can be picked up and dragged.
const DRAGGABLE_STATUSES: IssuePipelineStatus[] = ['todo', 'queued', 'failed']

// Statuses that are actively running in the pipeline — show a live indicator.
const ACTIVE_STATUSES: IssuePipelineStatus[] = ['planning', 'reviewing', 'revising', 'executing', 'verifying', 'shipping']

function DraggableCard({ issue, onClick, onRerun, isSelected }: { issue: GitHubIssueCacheRecord; onClick: () => void; onRerun?: (issue: GitHubIssueCacheRecord) => void; isSelected?: boolean }) {
	const draggable = DRAGGABLE_STATUSES.includes(issue.pipelineStatus)
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: issue.id,
		data: issue,
		disabled: !draggable,
	})

	const isFailed = issue.pipelineStatus === 'failed'
	const isAwaiting = issue.pipelineStatus === 'awaiting_approval'
	const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus)

	return (
		<div
			ref={setNodeRef}
			className={cn(
				'relative rounded-md border bg-elevated p-2 transition-colors outline-none',
				draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
				isSelected ? 'border-text-primary/60 bg-elevated' : 'border-border/50 hover:border-border-strong',
				isFailed && !isSelected && 'border-danger/40 bg-danger/[0.04] hover:border-danger/60',
				isAwaiting && !isSelected && 'border-warning/30 bg-warning/[0.03] hover:border-warning/50',
				isActive && !isSelected && 'border-accent/40 bg-accent/[0.03]',
				isDragging && 'opacity-50',
			)}
			{...listeners}
			{...attributes}
			onClick={(e) => { e.stopPropagation(); onClick() }}
		>
			{isActive && (
				<span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
			)}
			{isFailed && onRerun && (
				<button
					type="button"
					className="absolute top-1.5 right-1.5 rounded p-0.5 text-danger/60 hover:text-danger hover:bg-danger/10 transition-colors"
					title="Re-run pipeline"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => { e.stopPropagation(); onRerun(issue) }}
				>
					<RotateCcw size={11} />
				</button>
			)}
			<div className="text-[11px] text-secondary font-mono mb-0.5">#{issue.issueNumber}</div>
			<div className="text-xs leading-snug text-primary font-medium line-clamp-2">{issue.title}</div>
			<div className="flex flex-wrap gap-1 mt-1">
				{issue.labels.filter(l => l.startsWith('agent:')).map(l => (
					<Badge key={l} variant="accent" className="text-[10px] px-1.5 py-px font-medium">{l}</Badge>
				))}
				{issue.pipelineStatus !== COLUMNS.flatMap(c => c.sections ?? [{ statuses: c.statuses }]).find(s => s.statuses.includes(issue.pipelineStatus))?.statuses[0] && (
					<Badge variant={getStatusBadgeVariant(issue.pipelineStatus)} className="text-[10px] px-1.5 py-px font-medium">
						{issue.pipelineStatus}
					</Badge>
				)}
			</div>
		</div>
	)
}

function DroppableColumn({ id, label, issues, droppable, onIssueClick, selectedIssueNumber }: {
	id: string; label: string; issues: GitHubIssueCacheRecord[]; droppable: boolean
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	selectedIssueNumber?: number
}) {
	const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable })

	return (
		<div
			ref={setNodeRef}
			className={cn(
				'flex-1 min-w-[140px] max-w-[220px] flex flex-col bg-secondary rounded-md overflow-hidden transition-colors border border-border/40',
				isOver && droppable && 'ring-2 ring-accent bg-tertiary'
			)}
		>
			<div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary border-b border-border shrink-0">
				<span>{label}</span>
				<span className="text-[10px] bg-tertiary text-muted px-1.5 py-px rounded-full font-medium">{issues.length}</span>
			</div>
			<div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1 min-h-[60px]">
				{issues.map(issue => (
					<DraggableCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue)} isSelected={issue.issueNumber === selectedIssueNumber} />
				))}
			</div>
		</div>
	)
}

function SectionBlock({
	columnKey,
	section,
	issues,
	onIssueClick,
	onRerun,
	selectedIssueNumber,
}: {
	columnKey: ColumnKey
	section: PhaseSection
	issues: GitHubIssueCacheRecord[]
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	onRerun?: (issue: GitHubIssueCacheRecord) => void
	selectedIssueNumber?: number
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `${columnKey}:${section.key}`,
		disabled: !section.droppable,
	})
	const count = issues.length
	const empty = count === 0
	// Only the Agent Loop column shows agent badges. Human/Failed/Done skip them.
	const showAgent = columnKey === 'agent'
	// For the executor row, resolve per-issue from the first card; when empty, default.
	const agentLabel = section.agent === 'executor'
		? (issues[0]?.executorModel ?? 'claude')
		: section.agent

	// Tone highlights non-empty human-action sections so they pull the eye.
	// Stays null when the section is empty to avoid false alarms.
	const tone: 'danger' | 'warning' | null =
		section.key === 'failed' && !empty
			? 'danger'
			: section.key === 'awaiting' && !empty
				? 'warning'
				: null

	return (
		<div className="border-t border-border first:border-t-0">
			<div className={cn(
				'flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
				empty && 'text-muted opacity-50',
				!empty && !tone && 'text-secondary',
				tone === 'danger' && 'text-danger',
				tone === 'warning' && 'text-warning',
			)}>
				<span className="flex items-center gap-1.5">
					<span>{section.label}</span>
					{showAgent && (
						<span className="font-mono normal-case text-[9px] font-normal text-muted">
							· {MODEL_DISPLAY[agentLabel] ?? agentLabel}
						</span>
					)}
				</span>
				<span className={cn(
					// Always reserve a 1px border so the pill size doesn't shift when the
					// tone switches on/off as issues enter/leave the section.
					'text-[10px] bg-tertiary px-1.5 py-px rounded-full font-medium border border-transparent',
					empty && 'text-muted/70',
					!empty && !tone && 'text-muted',
					tone === 'danger' && 'bg-danger/15 text-danger border-danger/25',
					tone === 'warning' && 'bg-warning/15 text-warning border-warning/25',
				)}>{count}</span>
			</div>
			{!empty && (
				<div
					ref={section.droppable ? setNodeRef : undefined}
					className={cn(
						'flex flex-col gap-1 p-1.5 pt-0',
						section.droppable && isOver && 'bg-tertiary border border-dashed border-accent rounded-md'
					)}
				>
					{issues.map(issue => (
						<DraggableCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue)} onRerun={onRerun} isSelected={issue.issueNumber === selectedIssueNumber} />
					))}
				</div>
			)}
			{empty && section.droppable && (
				<div
					ref={setNodeRef}
					className={cn(
						'mx-1.5 mb-1.5 min-h-[36px] rounded border border-dashed',
						isOver ? 'border-accent bg-tertiary' : 'border-border/50'
					)}
				/>
			)}
		</div>
	)
}

function StackedColumn({
	column,
	issues,
	onIssueClick,
	onRerun,
	selectedIssueNumber,
}: {
	column: BoardColumn
	issues: GitHubIssueCacheRecord[]
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	onRerun?: (issue: GitHubIssueCacheRecord) => void
	selectedIssueNumber?: number
}) {
	const columnIssues = issues.filter(i => column.statuses.includes(i.pipelineStatus))

	return (
		<div className="flex-[1.3] min-w-[180px] max-w-[280px] flex flex-col bg-secondary rounded-md overflow-hidden border border-border/40">
			<div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary border-b border-border shrink-0">
				<span>{column.label}</span>
				<span className="text-[10px] bg-tertiary text-muted px-1.5 py-px rounded-full font-medium">{columnIssues.length}</span>
			</div>
			<div className="flex-1 overflow-y-auto min-h-[60px]">
				{(column.sections ?? []).map(section => {
					const sectionIssues = columnIssues.filter(i => section.statuses.includes(i.pipelineStatus))
					return (
						<SectionBlock
							key={section.key}
							columnKey={column.key}
							section={section}
							issues={sectionIssues}
							onIssueClick={onIssueClick}
							onRerun={onRerun}
							selectedIssueNumber={selectedIssueNumber}
						/>
					)
				})}
			</div>
		</div>
	)
}

// Custom collision detection: prefer whatever droppable the user's pointer is
// actually over (most intuitive for multi-column kanban), and fall back to
// rectangle intersection when the pointer is in a gap between columns.
// `closestCorners` was the prior default but it can pick a farther column as
// "closest" when you drag across the middle of a wide layout, which caused
// drag-to-Todo from Human to silently land on Agent Loop / Planning.
const customCollisionDetection: CollisionDetection = (args: Parameters<CollisionDetection>[0]) => {
	const pointerCollisions = pointerWithin(args)
	if (pointerCollisions.length > 0) return pointerCollisions
	return rectIntersection(args)
}

export function KanbanBoard({ issues, onIssueClick, onRefresh, onNewIssue, onStartPipeline, onRetry, onRerun, baseBranch, branches, onBaseBranchChange, selectedIssueNumber }: KanbanBoardProps) {
	const [activeId, setActiveId] = useState<string | null>(null)
	const activeIssue = issues.find(i => i.id === activeId)

	function getColumnForIssue(issue: GitHubIssueCacheRecord): ColumnKey {
		return COLUMNS.find(c => c.statuses.includes(issue.pipelineStatus))?.key ?? 'todo'
	}

	function handleDragStart(event: DragStartEvent) {
		setActiveId(event.active.id as string)
	}

	function handleDragEnd(event: DragEndEvent) {
		setActiveId(null)
		const { active, over } = event
		if (!over || !active.data.current) return

		const issue = active.data.current as GitHubIssueCacheRecord
		const sourceColumn = getColumnForIssue(issue)
		const dropId = String(over.id)

		// Only two transitions are allowed:
		// 1. todo → agent:planning (start pipeline)
		if (sourceColumn === 'todo' && dropId === 'agent:planning' && onStartPipeline) {
			onStartPipeline(issue)
			return
		}
		// 2. human → todo (retry failed, never awaiting_approval)
		if (sourceColumn === 'human' && dropId === 'todo' && issue.pipelineStatus === 'failed' && onRetry) {
			onRetry(issue)
			return
		}
		// All other drops: no-op (snap back)
	}

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="flex items-center px-4 py-3 border-b border-border shrink-0 gap-3">
				<h3 className="text-sm font-semibold shrink-0">GitHub Issues</h3>
				<div className="flex-1" />
				<div className="flex items-center gap-2 shrink-0">
					{baseBranch && branches && branches.length > 0 && onBaseBranchChange && (
						<div className="flex items-center gap-2 min-w-0 max-w-[200px] shrink-0">
							<span className="text-[11px] text-muted font-mono shrink-0">base:</span>
							<Select value={baseBranch} onValueChange={onBaseBranchChange}>
								<SelectTrigger className="h-7 text-xs font-mono truncate">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{branches.map((b) => (
										<SelectItem key={b} value={b} className="text-xs font-mono">{b}</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<button
						type="button"
						className="flex items-center justify-center h-7 w-7 bg-transparent border border-border rounded-md text-secondary cursor-pointer hover:text-primary hover:border-text-secondary"
						onClick={onRefresh}
						title="Refresh"
					>
						<RefreshCw size={13} />
					</button>
					{onNewIssue && (
						<button
							type="button"
							className="bg-accent text-accent-foreground rounded-md cursor-pointer px-2.5 py-1 text-xs font-medium hover:bg-accent-hover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
							onClick={onNewIssue}
						>
							+ New PRD
						</button>
					)}
				</div>
			</div>
			<DndContext
				collisionDetection={customCollisionDetection}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="flex flex-1 overflow-x-auto overflow-y-hidden gap-0.5 p-3 px-2">
					{COLUMNS.map(col => {
						if (col.sections) {
							return (
								<StackedColumn
									key={col.key}
									column={col}
									issues={issues}
									onIssueClick={onIssueClick}
									onRerun={onRerun}
									selectedIssueNumber={selectedIssueNumber}
								/>
							)
						}
						const columnIssues = issues.filter(i => col.statuses.includes(i.pipelineStatus))
						return (
							<DroppableColumn
								key={col.key}
								id={col.key}
								label={col.label}
								issues={columnIssues}
								droppable={!!col.droppable}
								onIssueClick={onIssueClick}
								selectedIssueNumber={selectedIssueNumber}
							/>
						)
					})}
				</div>
				<DragOverlay dropAnimation={null}>
					{activeIssue ? (
						<div className={cn(
							'opacity-80 bg-secondary border rounded-md p-2 shadow-lg cursor-grabbing',
							dragOverlayBorderClass(activeIssue.pipelineStatus),
						)}>
							<div className="text-[11px] text-muted font-mono mb-0.5">#{activeIssue.issueNumber}</div>
							<div className="text-xs leading-snug text-primary line-clamp-2">{activeIssue.title}</div>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</div>
	)
}
