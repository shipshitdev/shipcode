import { X } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

export function TerminalDrawer() {
	const { toggleTerminal, agentOutputs } = useAppStore()

	// Combine all agent outputs for display; slice to last 80 KB to prevent GPU OOM
	const allOutput = Object.entries(agentOutputs)
		.flatMap(([, chunks]) => chunks)
		.join('')
		.slice(-80_000)

	return (
		<div className="flex h-[250px] flex-col border-t border-border bg-bg-secondary">
			<div className="flex items-center justify-between border-b border-border px-3 py-1.5">
				<span className="text-xs font-semibold text-text-secondary">Terminal</span>
				<button
					type="button"
					className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
					onClick={toggleTerminal}
					title="Close terminal"
				>
					<X size={14} />
				</button>
			</div>
			<div className="flex-1 overflow-y-auto px-3 py-2">
				<pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-text-secondary">{allOutput || 'No output yet...'}</pre>
			</div>
		</div>
	)
}
