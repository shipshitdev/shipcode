import { useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GitHubIssueCacheRecord, NotificationRecord } from '@shipcode/shared'
import { useAppStore } from '../stores/app-store'

export function useIpc() {
	const queryClient = useQueryClient()
	const { setPlan, setReview, setPipelinePhase, setVerification, setGithubIssues, appendAgentOutput, addNotification, removeNotification } = useAppStore()

	useEffect(() => {
		const unsubscribers: (() => void)[] = []

		// Listen for pipeline phase changes (scoped by threadId)
		unsubscribers.push(
			window.shipcode.on('pipeline:phase', (data: any) => {
				const store = useAppStore.getState()
				if (data.threadId === store.activeThreadId) {
					setPipelinePhase(data.phase)
				}

				if (store.activeProjectId) {
					window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', { projectId: store.activeProjectId }).then((issues) => {
						useAppStore.getState().setGithubIssues(issues)

						const activeIssue = useAppStore.getState().activeIssue
						if (!activeIssue) return

						const refreshed = issues.find((issue) => issue.id === activeIssue.id) ?? null
						useAppStore.setState((state) => ({
							activeIssue: refreshed,
							activeThreadId: refreshed?.threadId ?? state.activeThreadId,
						}))
					}).catch(() => {
						// Best-effort sync only.
					})
				}
			})
		)

		// Listen for parsed plans (scoped by threadId)
		unsubscribers.push(
			window.shipcode.on('plan:parsed', (data: any) => {
				if (data.threadId === useAppStore.getState().activeThreadId) {
					setPlan(data.plan)
				}
			})
		)

		// Listen for parsed reviews (scoped by threadId)
		unsubscribers.push(
			window.shipcode.on('review:parsed', (data: any) => {
				if (data.threadId === useAppStore.getState().activeThreadId) {
					setReview(data.review)
				}
			})
		)

		// Listen for parsed verifications
		unsubscribers.push(
			window.shipcode.on('verification:parsed', (data: any) => {
				const store = useAppStore.getState()
				if (store.activeThreadId === data.threadId) {
					store.setVerification(data.verification)
				}
			})
		)

		// Listen for GitHub issues updates
		unsubscribers.push(
			window.shipcode.on('github:issues-updated', (data: any) => {
				const store = useAppStore.getState()
				store.setGithubIssues(data.issues)

				if (store.activeIssue) {
					const refreshed = data.issues.find((issue: any) => issue.id === store.activeIssue?.id) ?? null
					useAppStore.setState((state) => ({
						activeIssue: refreshed,
						activeThreadId: refreshed?.threadId ?? state.activeThreadId,
					}))
				}
			})
		)

		// Listen for agent output
		unsubscribers.push(
			window.shipcode.on('agent:output', (data: any) => {
				appendAgentOutput(data.processId, data.chunk)
			})
		)

		// === Mission Control: dashboard invalidation ===
		unsubscribers.push(
			window.shipcode.on('dashboard:invalidate', (data: any) => {
				const kinds: string[] = data?.kinds ?? ['stats', 'activity', 'running', 'recent']
				for (const kind of kinds) {
					queryClient.invalidateQueries({ queryKey: ['dashboard', kind] })
				}
			})
		)

		// === Notifications ===
		unsubscribers.push(
			window.shipcode.on('notification:fire', (...args: unknown[]) => {
				const record = args[0] as NotificationRecord
				const store = useAppStore.getState()
				// If the user is already viewing this thread in project view,
				// silently dismiss the notification rather than showing a toast.
				if (
					store.viewMode === 'project' &&
					record.threadId === store.activeThreadId
				) {
					window.shipcode.invoke('notification:dismiss', { id: record.id }).catch(() => {})
					return
				}
				addNotification(record)
			})
		)

		unsubscribers.push(
			window.shipcode.on('notification:focus-thread', (data: any) => {
				const store = useAppStore.getState()
				if (data.projectId) {
					store.selectProject(data.projectId)
				}
				store.selectThread(data.threadId)
				store.setViewMode('project')
			})
		)

		// Drop dismissed notifications from the in-memory toaster stack so the
		// "auto-dismiss after view" path stays in sync with the DB.
		unsubscribers.push(
			window.shipcode.on('notification:dismiss' as any, (data: any) => {
				if (data?.id) removeNotification(data.id)
			})
		)

		return () => {
			for (const unsub of unsubscribers) unsub()
		}
	}, [setPlan, setReview, setPipelinePhase, setVerification, setGithubIssues, appendAgentOutput, addNotification, removeNotification, queryClient])
}

export function useInvoke<T>(channel: string) {
	return useCallback(
		(args?: unknown): Promise<T> => window.shipcode.invoke<T>(channel, args),
		[channel]
	)
}
