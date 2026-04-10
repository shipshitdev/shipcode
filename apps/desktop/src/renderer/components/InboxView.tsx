import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { NotificationRecord, NotificationKind } from '@shipcode/shared'
import { Button, Loader2 } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

function timeAgo(input: string | number): string {
	const t = typeof input === 'number' ? input : new Date(input).getTime()
	const diff = Math.max(0, Date.now() - t)
	const s = Math.floor(diff / 1000)
	if (s < 60) return `${s}s ago`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ago`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h}h ago`
	const d = Math.floor(h / 24)
	return `${d}d ago`
}

const KIND_BADGE: Record<NotificationKind, string> = {
	awaiting_approval: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
	failed: 'bg-danger/15 text-danger border-danger/30',
	completed: 'bg-success/15 text-success border-success/30',
	verification_exhausted: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

const KIND_LABEL: Record<NotificationKind, string> = {
	awaiting_approval: 'Awaiting approval',
	failed: 'Failed',
	completed: 'Completed',
	verification_exhausted: 'Retries exhausted',
}

export function InboxView() {
	const queryClient = useQueryClient()
	const { removeNotification, clearNotifications, selectProject } = useAppStore()

	const { data: notifications = [], isLoading, isError, refetch } = useQuery<NotificationRecord[]>({
		queryKey: ['notifications'],
		queryFn: () => window.shipcode.invoke<NotificationRecord[]>('notification:list'),
		refetchInterval: 5000,
	})

	const active = notifications.filter((n) => n.dismissedAt === null)

	const dismiss = useMutation({
		mutationFn: (id: string) => window.shipcode.invoke('notification:dismiss', { id }),
		onSuccess: (_, id) => {
			removeNotification(id)
			queryClient.invalidateQueries({ queryKey: ['notifications'] })
		},
	})

	const dismissAll = useMutation({
		mutationFn: () => window.shipcode.invoke('notification:dismiss-all'),
		onSuccess: () => {
			clearNotifications()
			queryClient.invalidateQueries({ queryKey: ['notifications'] })
		},
	})

	useEffect(() => {
		const unsub = window.shipcode.on('notification:fire', () => {
			queryClient.invalidateQueries({ queryKey: ['notifications'] })
		})
		return () => unsub()
	}, [queryClient])

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex items-center justify-between border-b border-border px-6 py-4">
				<div>
					<h1 className="text-base font-semibold text-text-primary">Inbox</h1>
					<p className="text-xs text-text-muted">Notifications requiring attention.</p>
				</div>
				{active.length > 0 && (
					<Button
						variant="secondary"
						size="sm"
						onClick={() => dismissAll.mutate()}
						disabled={dismissAll.isPending}
					>
						Dismiss all
					</Button>
				)}
			</div>

			<div className="flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto max-w-3xl">
					{isLoading && (
						<div className="flex items-center justify-center py-16">
							<Loader2 size={20} className="animate-spin text-text-muted" />
						</div>
					)}

					{isError && (
						<div className="flex flex-col items-center gap-3 py-16 text-center">
							<p className="text-sm text-text-secondary">Failed to load notifications.</p>
							<Button variant="secondary" size="sm" onClick={() => refetch()}>Retry</Button>
						</div>
					)}

					{!isLoading && !isError && active.length === 0 && (
						<div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-text-muted">
							All caught up. No pending notifications.
						</div>
					)}

					{!isLoading && !isError && active.length > 0 && (
						<ul className="space-y-3">
							{active.map((n) => (
								<li
									key={n.id}
									className="rounded-lg border border-border bg-bg-elevated p-4"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-center gap-2">
											<span
												className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[n.kind]}`}
											>
												{KIND_LABEL[n.kind]}
											</span>
											<span className="text-[13px] font-medium text-text-primary">{n.title}</span>
										</div>
										<span className="shrink-0 text-[10px] text-text-muted">{timeAgo(n.createdAt)}</span>
									</div>

									{n.body && (
										<p className="mt-2 text-[12px] text-text-secondary">{n.body}</p>
									)}

									<div className="mt-3 flex items-center gap-2">
										{n.projectId !== null && (
											<Button
												variant="secondary"
												size="xs"
												onClick={() => selectProject(n.projectId!)}
											>
												→ Go to project
											</Button>
										)}
										<Button
											variant="ghost"
											size="xs"
											onClick={() => dismiss.mutate(n.id)}
											disabled={dismiss.isPending && dismiss.variables === n.id}
										>
											Dismiss
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}
