import { useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'

export function useIpc() {
	const { setPlan, setReview, setPipelinePhase, setVerification, setGithubIssues, appendAgentOutput } = useAppStore()

	useEffect(() => {
		const unsubscribers: (() => void)[] = []

		// Listen for pipeline phase changes
		unsubscribers.push(
			window.crosscode.on('pipeline:phase', (data: any) => {
				setPipelinePhase(data.phase)
			})
		)

		// Listen for parsed plans
		unsubscribers.push(
			window.crosscode.on('plan:parsed', (data: any) => {
				setPlan(data.plan)
			})
		)

		// Listen for parsed reviews
		unsubscribers.push(
			window.crosscode.on('review:parsed', (data: any) => {
				setReview(data.review)
			})
		)

		// Listen for parsed verifications
		unsubscribers.push(
			window.crosscode.on('verification:parsed', (data: any) => {
				const store = useAppStore.getState()
				if (store.activeThreadId === data.threadId) {
					store.setVerification(data.verification)
				}
			})
		)

		// Listen for GitHub issues updates
		unsubscribers.push(
			window.crosscode.on('github:issues-updated', (data: any) => {
				useAppStore.getState().setGithubIssues(data.issues)
			})
		)

		// Listen for agent output
		unsubscribers.push(
			window.crosscode.on('agent:output', (data: any) => {
				appendAgentOutput(data.processId, data.chunk)
			})
		)

		return () => {
			for (const unsub of unsubscribers) unsub()
		}
	}, [setPlan, setReview, setPipelinePhase, setVerification, setGithubIssues, appendAgentOutput])
}

export function useInvoke<T>(channel: string) {
	return useCallback(
		(args?: unknown): Promise<T> => window.crosscode.invoke<T>(channel, args),
		[channel]
	)
}
