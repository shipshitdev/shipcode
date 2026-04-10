import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ActivityEntry } from '@shipcode/shared'
import { Card, CardContent, Loader2, Button, Table, TableBody, TableCell, TableRow } from '@shipcode/ui'
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

function dayLabel(isoStr: string): string {
	const date = new Date(isoStr)
	const today = new Date()
	const yesterday = new Date()
	yesterday.setDate(today.getDate() - 1)

	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()

	if (sameDay(date, today)) return 'Today'
	if (sameDay(date, yesterday)) return 'Yesterday'
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function groupByDay(entries: ActivityEntry[]): { label: string; entries: ActivityEntry[] }[] {
	const groups: { label: string; entries: ActivityEntry[] }[] = []
	let currentLabel: string | null = null

	for (const entry of entries) {
		const label = dayLabel(entry.createdAt)
		if (label !== currentLabel) {
			currentLabel = label
			groups.push({ label, entries: [] })
		}
		groups[groups.length - 1].entries.push(entry)
	}

	return groups
}

export function ActivityView() {
	const queryClient = useQueryClient()
	const { selectProject, selectThread } = useAppStore()

	const { data: activity = [], isLoading, isError, refetch } = useQuery<ActivityEntry[]>({
		queryKey: ['activity', { limit: 200 }],
		queryFn: () => window.shipcode.invoke<ActivityEntry[]>('dashboard:get-activity', { limit: 200 }),
		refetchInterval: 10_000,
	})

	useEffect(() => {
		const unsub = window.shipcode.on('dashboard:invalidate', (data: unknown) => {
			const kinds = (data as { kinds?: string[] } | null)?.kinds
			if (kinds?.includes('activity')) {
				queryClient.invalidateQueries({ queryKey: ['activity', { limit: 200 }] })
			}
		})
		return () => unsub()
	}, [queryClient])

	const groups = groupByDay(activity)

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="border-b border-border px-6 py-4">
				<h1 className="text-base font-semibold text-primary">Activity</h1>
				<p className="text-xs text-muted">All pipeline events across every project.</p>
			</div>

			<div className="flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto max-w-3xl">
					{isLoading && (
						<div className="flex items-center justify-center py-16">
							<Loader2 size={20} className="animate-spin text-muted" />
						</div>
					)}

					{isError && (
						<div className="flex flex-col items-center gap-3 py-16 text-center">
							<p className="text-sm text-secondary">Failed to load activity.</p>
							<Button variant="secondary" size="sm" onClick={() => refetch()}>Retry</Button>
						</div>
					)}

					{!isLoading && !isError && activity.length === 0 && (
						<div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted">
							No activity yet.
						</div>
					)}

					{!isLoading && !isError && groups.map((group) => (
						<div key={group.label} className="mb-6">
							<div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
								{group.label}
							</div>
							<Card>
								<CardContent className="p-0">
									<Table>
										<TableBody>
											{group.entries.map((entry) => {
												const clickable = entry.projectId !== null

												return (
													<TableRow
														key={entry.id}
														className={clickable ? 'cursor-pointer hover:bg-hover' : undefined}
														onClick={() => {
															if (entry.projectId) {
																selectProject(entry.projectId)
																if (entry.threadId) selectThread(entry.threadId)
															}
														}}
													>
														<TableCell className="w-px whitespace-nowrap pr-2 align-top pt-2.5">
															<span className="inline-flex items-center justify-center rounded border border-border bg-tertiary px-1 py-0.5 text-[9px] uppercase text-muted">
																{entry.actor}
															</span>
														</TableCell>
														<TableCell className="max-w-0 w-full">
															<div className="truncate text-[12px] text-primary">{entry.title}</div>
															{entry.subtitle && (
																<div className="truncate text-[11px] text-muted">{entry.subtitle}</div>
															)}
														</TableCell>
														<TableCell className="w-px whitespace-nowrap text-right text-[10px] text-muted">
															{timeAgo(entry.createdAt)}
														</TableCell>
													</TableRow>
												)
											})}
										</TableBody>
									</Table>
								</CardContent>
							</Card>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
