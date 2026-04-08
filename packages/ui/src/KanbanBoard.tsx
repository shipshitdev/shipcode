import { useState } from 'react'
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import type { GitHubIssueCacheRecord, IssuePipelineStatus } from '@shipcode/shared'
import { cn } from './lib/utils'
import { Badge } from './primitives/badge'

interface KanbanBoardProps {
	issues: GitHubIssueCacheRecord[]
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	onRefresh: () => void
	onStartPipeline?: (issue: GitHubIssueCacheRecord) => void
	onRetry?: (issue: GitHubIssueCacheRecord) => void
}

const COLUMNS: { key: string; label: string; statuses: IssuePipelineStatus[]; droppable: boolean }[] = [
	{ key: 'todo', label: 'Todo', statuses: ['todo', 'queued'], droppable: true },
	{ key: 'planning', label: 'Planning', statuses: ['planning'], droppable: true },
	{ key: 'reviewing', label: 'Reviewing', statuses: ['reviewing', 'revising'], droppable: false },
	{ key: 'executing', label: 'Executing', statuses: ['executing'], droppable: false },
	{ key: 'verifying', label: 'Verifying', statuses: ['verifying', 'shipping'], droppable: false },
	{ key: 'completed', label: 'Completed', statuses: ['completed'], droppable: false },
	{ key: 'failed', label: 'Failed', statuses: ['failed'], droppable: true },
]

function DraggableCard({ issue, onClick }: { issue: GitHubIssueCacheRecord; onClick: () => void }) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: issue.id,
		data: issue,
	})

	const style = transform ? {
		transform: `translate(${transform.x}px, ${transform.y}px)`,
	} : undefined

	return (
		<div
			ref={setNodeRef}
			className={cn(
				'rounded-md border border-border bg-bg-primary p-2 cursor-grab hover:border-text-muted transition-colors active:cursor-grabbing',
				isDragging && 'opacity-50'
			)}
			style={style}
			{...listeners}
			{...attributes}
			onClick={(e) => { e.stopPropagation(); onClick() }}
		>
			<div className="text-[11px] text-text-muted font-mono mb-0.5">#{issue.issueNumber}</div>
			<div className="text-xs leading-snug text-text-primary line-clamp-2">{issue.title}</div>
			<div className="flex flex-wrap gap-1 mt-1">
				{issue.labels.filter(l => l.startsWith('agent:')).map(l => (
					<Badge key={l} variant="accent" className="text-[10px] px-1.5 py-px">{l}</Badge>
				))}
				{issue.pipelineStatus !== COLUMNS.find(c => c.statuses.includes(issue.pipelineStatus))?.statuses[0] && (
					<Badge className="text-[10px] px-1.5 py-px">{issue.pipelineStatus}</Badge>
				)}
			</div>
		</div>
	)
}

function DroppableColumn({ id, label, issues, droppable, onIssueClick }: {
	id: string; label: string; issues: GitHubIssueCacheRecord[]; droppable: boolean
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
}) {
	const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable })

	return (
		<div className="flex-1 min-w-[160px] max-w-[240px] flex flex-col bg-bg-secondary rounded-md overflow-hidden">
			<div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary border-b border-border shrink-0">
				<span>{label}</span>
				<span className="text-[10px] bg-bg-tertiary text-text-muted px-1.5 py-px rounded-full font-medium">{issues.length}</span>
			</div>
			<div
				ref={setNodeRef}
				className={cn(
					'flex-1 overflow-y-auto p-1.5 flex flex-col gap-1 min-h-[60px]',
					isOver && droppable && 'bg-bg-tertiary border border-dashed border-accent rounded-md'
				)}
			>
				{issues.map(issue => (
					<DraggableCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue)} />
				))}
			</div>
		</div>
	)
}

export function KanbanBoard({ issues, onIssueClick, onRefresh, onStartPipeline, onRetry }: KanbanBoardProps) {
	const [activeId, setActiveId] = useState<string | null>(null)
	const activeIssue = issues.find(i => i.id === activeId)

	function getColumnForIssue(issue: GitHubIssueCacheRecord): string {
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
		const destColumn = over.id as string

		if (sourceColumn === destColumn) return

		// Only allow: todo -> planning, failed -> todo
		if (sourceColumn === 'todo' && destColumn === 'planning' && onStartPipeline) {
			onStartPipeline(issue)
		} else if (sourceColumn === 'failed' && destColumn === 'todo' && onRetry) {
			onRetry(issue)
		}
		// All other transitions are rejected (card snaps back)
	}

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
				<h3 className="text-sm font-semibold">GitHub Issues</h3>
				<button
					type="button"
					className="bg-transparent border border-border rounded-md text-text-secondary cursor-pointer px-2.5 py-1 text-xs hover:text-text-primary hover:border-text-secondary"
					onClick={onRefresh}
				>
					Refresh
				</button>
			</div>
			<DndContext
				collisionDetection={closestCorners}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="flex flex-1 overflow-x-auto overflow-y-hidden gap-0.5 p-3 px-2">
					{COLUMNS.map(col => {
						const columnIssues = issues.filter(i => col.statuses.includes(i.pipelineStatus))
						return (
							<DroppableColumn
								key={col.key}
								id={col.key}
								label={col.label}
								issues={columnIssues}
								droppable={col.droppable}
								onIssueClick={onIssueClick}
							/>
						)
					})}
				</div>
				<DragOverlay>
					{activeIssue ? (
						<div className="opacity-80 bg-bg-secondary border border-accent rounded-md p-2 shadow-lg cursor-grabbing">
							<div className="text-[11px] text-text-muted font-mono mb-0.5">#{activeIssue.issueNumber}</div>
							<div className="text-xs leading-snug text-text-primary line-clamp-2">{activeIssue.title}</div>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</div>
	)
}
