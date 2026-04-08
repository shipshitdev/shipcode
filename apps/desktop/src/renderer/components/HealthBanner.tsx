import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { Alert, AlertDescription, Button } from '@shipcode/ui'
import type { AppSettings, SystemHealth } from '@shipcode/shared'

export function HealthBanner() {
	const queryClient = useQueryClient()
	const { systemHealth, setSystemHealth } = useAppStore()

	const { data } = useQuery<SystemHealth>({
		queryKey: ['health'],
		queryFn: () => window.shipcode.invoke('health:check'),
		staleTime: 60_000,
	})

	const resetOnboarding = useMutation({
		mutationFn: () =>
			window.shipcode.invoke('settings:set', { onboardingVersion: 0 } as Partial<AppSettings>),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['settings'] })
		},
	})

	useEffect(() => {
		if (data) setSystemHealth(data)
	}, [data, setSystemHealth])

	if (!systemHealth) return null

	const issues: string[] = []
	if (!systemHealth.claude.available) issues.push('Claude CLI not found')
	if (!systemHealth.codex.available) issues.push('Codex CLI not found')
	if (!systemHealth.git.available) issues.push('Git not found')

	// Auth warnings (only for installed CLIs)
	if (systemHealth.claude.available && !systemHealth.claude.authenticated) {
		issues.push('Claude CLI not authenticated')
	}
	if (systemHealth.codex.available && !systemHealth.codex.authenticated) {
		issues.push('Codex CLI not authenticated')
	}

	if (issues.length === 0) return null

	return (
		<Alert
			variant="warning"
			className="flex items-center gap-2 rounded-none border-x-0 border-t-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs"
		>
			<span className="text-base font-bold leading-none">!</span>
			<AlertDescription className="text-xs text-warning">
				{issues.join(' \u00b7 ')}.
			</AlertDescription>
			<Button
				variant="ghost"
				size="sm"
				className="ml-auto border border-warning text-warning text-[11px] hover:bg-warning/15"
				onClick={() => resetOnboarding.mutate()}
				disabled={resetOnboarding.isPending}
			>
				Re-run Setup
			</Button>
		</Alert>
	)
}
