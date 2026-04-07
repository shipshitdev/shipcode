import type { Thread } from '@shipcode/shared'

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
	verifying: 'Verifying...',
	shipping: 'Shipping...',
	completed: 'Done',
	failed: 'Failed',
}

export function ThreadList({ threads, activeThreadId, onThreadSelect, onNewThread }: ThreadListProps) {
	return (
		<div className="thread-list">
			<div className="thread-list__items">
				{threads.length === 0 ? (
					<div className="thread-list__empty">
						<p>No threads yet</p>
						<p className="thread-list__hint">Create one to get started</p>
					</div>
				) : (
					threads.map((thread) => (
						<button
							type="button"
							key={thread.id}
							className={`thread-list__item ${activeThreadId === thread.id ? 'thread-list__item--active' : ''}`}
							onClick={() => onThreadSelect(thread.id)}
						>
							<div className="thread-list__item-title">{thread.title}</div>
							<div className="thread-list__item-meta">
								<span className={`thread-list__status thread-list__status--${thread.status}`}>
									{STATUS_LABELS[thread.status] ?? thread.status}
								</span>
								<span className="thread-list__time">
									{formatRelativeTime(thread.updatedAt)}
								</span>
							</div>
						</button>
					))
				)}
			</div>

			<button type="button" className="thread-list__new" onClick={onNewThread}>
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
