import { useState } from 'react'
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import type { GitHubIssueCacheRecord, IssuePipelineStatus } from '@shipcode/shared'

interface KanbanBoardProps {
	issues: GitHubIssueCacheRecord[]
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	onRefresh: () => void
	onStartPipeline?: (issue: GitHubIssueCacheRecord) => void
	onRetry?: (issue: GitHubIssueCacheRecord) => void
}

const COLUMNS: { key: string; label: string; statuses: IssuePipelineStatus[]; droppable: boolean }[] = [
	{ key: 'todo', label: 'Todo', statuses: ['todo'], droppable: true },
	{ key: 'planning', label: 'Planning', statuses: ['queued', 'planning'], droppable: true },
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
		opacity: isDragging ? 0.5 : 1,
	} : undefined

	return (
		<div
			ref={setNodeRef}
			className="kanban__card"
			style={style}
			{...listeners}
			{...attributes}
			onClick={(e) => { e.stopPropagation(); onClick() }}
		>
			<div className="kanban__card-number">#{issue.issueNumber}</div>
			<div className="kanban__card-title">{issue.title}</div>
			<div className="kanban__card-labels">
				{issue.labels.filter(l => l.startsWith('agent:')).map(l => (
					<span key={l} className="kanban__card-label">{l}</span>
				))}
				{issue.pipelineStatus !== COLUMNS.find(c => c.statuses.includes(issue.pipelineStatus))?.statuses[0] && (
					<span className="kanban__card-substatus">{issue.pipelineStatus}</span>
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
		<div className="kanban__column">
			<div className="kanban__column-header">
				<span>{label}</span>
				<span className="kanban__column-count">{issues.length}</span>
			</div>
			<div
				ref={setNodeRef}
				className={`kanban__column-body ${isOver && droppable ? 'kanban__column-body--over' : ''}`}
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
		<div className="kanban">
			<div className="kanban__header">
				<h3>GitHub Issues</h3>
				<button type="button" className="kanban__refresh" onClick={onRefresh}>Refresh</button>
			</div>
			<DndContext
				collisionDetection={closestCorners}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="kanban__columns">
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
						<div className="kanban__card kanban__card--dragging">
							<div className="kanban__card-number">#{activeIssue.issueNumber}</div>
							<div className="kanban__card-title">{activeIssue.title}</div>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</div>
	)
}
