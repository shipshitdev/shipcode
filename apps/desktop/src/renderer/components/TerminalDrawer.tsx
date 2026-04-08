import { useAppStore } from '../stores/app-store'

export function TerminalDrawer() {
	const { toggleTerminal, agentOutputs } = useAppStore()

	// Combine all agent outputs for display
	const allOutput = Object.entries(agentOutputs)
		.flatMap(([, chunks]) => chunks)
		.join('')

	return (
		<div className="flex h-[250px] flex-col border-t border-border bg-bg-secondary">
			<div className="flex items-center justify-between border-b border-border px-3 py-1.5">
				<span className="text-xs font-semibold text-text-secondary">Terminal</span>
				<button
					type="button"
					className="cursor-pointer rounded border-none bg-transparent px-1.5 py-0.5 text-text-secondary hover:bg-bg-hover"
					onClick={toggleTerminal}
				>
					✕
				</button>
			</div>
			<div className="flex-1 overflow-y-auto px-3 py-2">
				<pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-text-secondary">{allOutput || 'No output yet...'}</pre>
			</div>
		</div>
	)
}
