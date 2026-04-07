import { useAppStore } from '../stores/app-store'

export function TerminalDrawer() {
	const { toggleTerminal, agentOutputs } = useAppStore()

	// Combine all agent outputs for display
	const allOutput = Object.entries(agentOutputs)
		.flatMap(([, chunks]) => chunks)
		.join('')

	return (
		<div className="terminal-drawer">
			<div className="terminal-drawer__header">
				<span className="terminal-drawer__title">Terminal</span>
				<button type="button" className="terminal-drawer__close" onClick={toggleTerminal}>
					✕
				</button>
			</div>
			<div className="terminal-drawer__content">
				<pre className="terminal-drawer__output">{allOutput || 'No output yet...'}</pre>
			</div>
		</div>
	)
}
