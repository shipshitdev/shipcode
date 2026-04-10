import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

// Strip the final JSON result envelope that claude -p --output-format json emits.
// This blob is parser metadata — not useful to the human reading the terminal.
// Pattern: {"type":"result", ... } spanning an entire chunk boundary.
const JSON_RESULT_RE = /\{"type":"result"[^\n]*\n?/g

function sanitize(chunk: string): string {
	return chunk.replace(JSON_RESULT_RE, '')
}

export function TerminalDrawer() {
	const { toggleTerminal, agentOutputs } = useAppStore()
	const activeThreadId = useAppStore((s) => s.activeThreadId)
	const containerRef = useRef<HTMLDivElement>(null)
	const termRef = useRef<Terminal | null>(null)
	const fitRef = useRef<FitAddon | null>(null)
	const writtenRef = useRef<Record<string, number>>({})
	const prevThreadIdRef = useRef<string | null>(null)

	// Init xterm once
	useEffect(() => {
		if (!containerRef.current) return
		const term = new Terminal({
			theme: {
				background: '#0c0d10',
				foreground: '#b4b4bc',
				cursor: '#f4f4f5',
				selectionBackground: 'rgba(244, 244, 245, 0.2)',
			},
			fontFamily: '"SF Mono", SFMono-Regular, Consolas, Menlo, monospace',
			fontSize: 12,
			lineHeight: 1.5,
			cursorBlink: false,
			disableStdin: true,
			scrollback: 5000,
		})
		const fit = new FitAddon()
		term.loadAddon(fit)
		term.open(containerRef.current)
		fit.fit()
		termRef.current = term
		fitRef.current = fit

		const ro = new ResizeObserver(() => fit.fit())
		ro.observe(containerRef.current)

		return () => {
			ro.disconnect()
			term.dispose()
			termRef.current = null
			fitRef.current = null
		}
	}, [])

	// Clear terminal when the active thread changes (user switched tasks)
	useEffect(() => {
		const term = termRef.current
		if (!term) return
		if (activeThreadId !== prevThreadIdRef.current) {
			term.reset()
			writtenRef.current = {}
			prevThreadIdRef.current = activeThreadId
		}
	}, [activeThreadId])

	// Write incremental chunks as they arrive
	useEffect(() => {
		const term = termRef.current
		if (!term) return

		for (const [processId, chunks] of Object.entries(agentOutputs)) {
			const prev = writtenRef.current[processId] ?? 0
			if (chunks.length > prev) {
				for (const chunk of chunks.slice(prev)) {
					const clean = sanitize(chunk)
					if (clean) term.write(clean)
				}
				writtenRef.current[processId] = chunks.length
			}
		}

		// Clean up tracking for removed processes
		for (const processId of Object.keys(writtenRef.current)) {
			if (!agentOutputs[processId]) {
				delete writtenRef.current[processId]
			}
		}
	}, [agentOutputs])

	return (
		<div className="flex h-[250px] flex-col border-t border-border bg-secondary">
			<div className="flex items-center justify-between border-b border-border px-3 py-1.5">
				<span className="text-xs font-semibold text-secondary">Terminal</span>
				<button
					type="button"
					className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-secondary hover:bg-hover hover:text-primary"
					onClick={toggleTerminal}
					title="Close terminal"
				>
					<X size={14} />
				</button>
			</div>
			<div ref={containerRef} className="flex-1 overflow-hidden" />
		</div>
	)
}
