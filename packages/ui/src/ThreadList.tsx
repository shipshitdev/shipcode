import type { Thread } from '@shipcode/shared'
import { cn } from './lib/utils'
import { Badge } from './primitives/badge'

interface ThreadListProps {
	threads: Thread[]
	activeThreadId: string | null
	onThreadSelect: (threadId: string) => void
	onNewThread: () => void
}

const STATUS_LABELS: Record<string, string> = {
	idle: 'Idle',
	planning: 'Planning...',
	reviewing: 'Reviewing...',
	revising: 'Revising...',
	awaiting_approval: 'Needs Approval',
	executing: 'Executing...',
	shipping: 'Shipping...',
	completed: 'Done',
	failed: 'Failed',
}

function getStatusVariant(status: string) {
	switch (status) {
		case 'planning':
		case 'reviewing':
		case 'revising':
		case 'executing':
			return 'accent' as const
		case 'completed':
			return 'success' as const
		case 'failed':
			return 'danger' as const
		case 'awaiting_approval':
			return 'warning' as const
		default:
			return 'default' as const
	}
}

export function ThreadList({ threads, activeThreadId, onThreadSelect, onNewThread }: ThreadListProps) {
	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto p-2">
				{threads.length === 0 ? (
					<div className="p-6 text-center text-text-muted">
						<p>No threads yet</p>
						<p className="text-xs mt-1">Create one to get started</p>
					</div>
				) : (
					threads.map((thread) => (
						<button
							type="button"
							key={thread.id}
							className={cn(
								'block w-full px-3 py-2.5 bg-transparent border-none rounded-md text-text-primary cursor-pointer text-left mb-0.5 hover:bg-bg-hover',
								activeThreadId === thread.id && 'bg-bg-tertiary'
							)}
							onClick={() => onThreadSelect(thread.id)}
						>
							<div className="text-[13px] font-medium truncate">{thread.title}</div>
							<div className="flex justify-between mt-1 text-[11px]">
								<Badge variant={getStatusVariant(thread.status)}>
									{STATUS_LABELS[thread.status] ?? thread.status}
								</Badge>
								<span className="text-text-muted">
									{formatRelativeTime(thread.updatedAt)}
								</span>
							</div>
						</button>
					))
				)}
			</div>

			<button
				type="button"
				className="m-2 p-2.5 bg-transparent border border-dashed border-border rounded-md text-text-secondary cursor-pointer text-[13px] hover:border-accent hover:text-accent"
				onClick={onNewThread}
			>
				+ New Thread
			</button>
		</div>
	)
}

function formatRelativeTime(isoString: string): string {
	const now = Date.now()
	const then = new Date(isoString).getTime()
	const diffSeconds = Math.floor((now - then) / 1000)

	if (diffSeconds < 60) return 'just now'
	if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
	if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
	return `${Math.floor(diffSeconds / 86400)}d ago`
}
