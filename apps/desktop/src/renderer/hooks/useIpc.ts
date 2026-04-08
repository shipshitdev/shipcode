import { useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'

export function useIpc() {
	const { setPlan, setReview, setPipelinePhase, setVerification, setGithubIssues, appendAgentOutput } = useAppStore()

	useEffect(() => {
		const unsubscribers: (() => void)[] = []

		// Listen for pipeline phase changes (scoped by threadId)
		unsubscribers.push(
			window.shipcode.on('pipeline:phase', (data: any) => {
				if (data.threadId === useAppStore.getState().activeThreadId) {
					setPipelinePhase(data.phase)
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
				useAppStore.getState().setGithubIssues(data.issues)
			})
		)

		// Listen for agent output
		unsubscribers.push(
			window.shipcode.on('agent:output', (data: any) => {
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
		(args?: unknown): Promise<T> => window.shipcode.invoke<T>(channel, args),
		[channel]
	)
}
