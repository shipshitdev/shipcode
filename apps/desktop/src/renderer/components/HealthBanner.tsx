import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import type { SystemHealth } from '@crosscode/shared'

export function HealthBanner() {
	const { systemHealth, setSystemHealth } = useAppStore()

	const { data } = useQuery<SystemHealth>({
		queryKey: ['health'],
		queryFn: () => window.crosscode.invoke('health:check'),
		staleTime: 60_000,
	})

	useEffect(() => {
		if (data) setSystemHealth(data)
	}, [data, setSystemHealth])

	if (!systemHealth) return null

	const issues: string[] = []
	if (!systemHealth.claude.available) issues.push('Claude Code CLI not found')
	if (!systemHealth.codex.available) issues.push('Codex CLI not found')
	if (!systemHealth.git.available) issues.push('Git not found')

	if (issues.length === 0) return null

	return (
		<div className="health-banner">
			<span className="health-banner__icon">⚠️</span>
			<span className="health-banner__text">
				{issues.join(' · ')}. Run <code>claude login</code> / <code>codex login</code> to set up.
			</span>
		</div>
	)
}
