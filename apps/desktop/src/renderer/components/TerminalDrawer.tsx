import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

// Strip the final JSON result envelope that claude -p --output-format stream-json emits.
// The result blob is for StreamParser; not useful to display in the terminal.
const JSON_RESULT_RE = /\{"type":"result"[^\n]*\n?/g

function sanitize(chunk: string): string {
	return chunk.replace(JSON_RESULT_RE, '')
}

/**
 * Extract displayable text from a single parsed NDJSON event.
 * Handles both claude --output-format stream-json and codex exec --json formats.
 * Returns null for events that should not be displayed (system noise, etc.).
 */
function extractNdjsonText(event: Record<string, unknown>): string | null {
	// ── claude stream-json ──────────────────────────────────────────────────
	if (event.type === 'assistant') {
		const content = (event.message as Record<string, unknown>)?.content
		if (Array.isArray(content)) {
			const text = content
				.filter((c: unknown) => (c as Record<string, unknown>)?.type === 'text')
				.map((c: unknown) => (c as Record<string, unknown>)?.text as string ?? '')
				.join('')
			return text || null
		}
	}

	// ── codex exec --json ───────────────────────────────────────────────────
	const item = event.item as Record<string, unknown> | undefined
	if (event.type === 'item.started' && item?.type === 'command_execution') {
		// Show the shell command being run (yellow)
		return `\x1b[33m$ ${item.command as string}\x1b[0m`
	}
	if (event.type === 'item.completed' && item?.type === 'agent_message') {
		return (item.text as string) || null
	}
	if (event.type === 'item.completed' && item?.type === 'command_execution') {
		const code = item.exit_code as number | null
		return code === 0 ? '\x1b[32m[exit 0]\x1b[0m' : `\x1b[31m[exit ${code}]\x1b[0m`
	}

	return null
}

export function TerminalDrawer() {
	const { toggleTerminal, agentOutputs } = useAppStore()
	const terminalEvents = useAppStore((s) => s.terminalEvents)
	const activeThreadId = useAppStore((s) => s.activeThreadId)
	const containerRef = useRef<HTMLDivElement>(null)
	const termRef = useRef<Terminal | null>(null)
	const fitRef = useRef<FitAddon | null>(null)
	// Track how many chunks have been written per process (regular streaming)
	const writtenRef = useRef<Record<string, number | typeof Infinity>>({})
	// Buffer incomplete NDJSON lines across PTY read chunks
	const lineBufferRef = useRef<Record<string, string>>({})
	const prevThreadIdRef = useRef<string | null>(null)
	// Track how many terminal event lines have been written
	const eventsWrittenRef = useRef(0)

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
			lineBufferRef.current = {}
			eventsWrittenRef.current = 0
			prevThreadIdRef.current = activeThreadId
		}
	}, [activeThreadId])

	// Write incremental agent output as chunks arrive
	useEffect(() => {
		const term = termRef.current
		if (!term) return

		for (const [processId, chunks] of Object.entries(agentOutputs)) {
			if (writtenRef.current[processId] === Infinity) continue

			const prev = (writtenRef.current[processId] as number) ?? 0
			const newChunks = chunks.slice(prev)
			if (newChunks.length === 0) continue

			// Detect NDJSON (stream-json) mode: look across first ~10 chunks since
			// PTY may emit control sequences before the first JSON line.
			const isNdjson =
				processId in lineBufferRef.current ||
				chunks.slice(0, 10).join('').includes('{"type":"')

			if (isNdjson) {
				// Buffer-based line processing — handles PTY chunks that split NDJSON lines
				let buf = (lineBufferRef.current[processId] ?? '') + newChunks.join('')
				const lines = buf.split('\n')
				// Keep the last (potentially incomplete) segment in the buffer
				lineBufferRef.current[processId] = lines.pop() ?? ''

				for (const line of lines) {
					const trimmed = line.trim()
					if (!trimmed) continue
					try {
						const event = JSON.parse(trimmed) as Record<string, unknown>
						const text = extractNdjsonText(event)
						if (text) {
							const normalized = text.replace(/\r?\n/g, '\r\n')
							term.write(normalized.endsWith('\r\n') ? normalized : normalized + '\r\n')
						}
					} catch {
						// Partial or non-JSON segment — skip silently
					}
				}
			} else {
				// Non-NDJSON streaming (e.g. plain-text PTY output from legacy providers)
				for (const chunk of newChunks) {
					const clean = sanitize(chunk)
					if (clean) term.write(clean)
				}
			}
			writtenRef.current[processId] = chunks.length
		}

		// Clean up tracking for removed processes
		for (const processId of Object.keys(writtenRef.current)) {
			if (!agentOutputs[processId]) {
				delete writtenRef.current[processId]
				delete lineBufferRef.current[processId]
			}
		}
	}, [agentOutputs])

	// Write pipeline event log lines (phase transitions, process lifecycle)
	useEffect(() => {
		const term = termRef.current
		if (!term) return
		const newEvents = terminalEvents.slice(eventsWrittenRef.current)
		for (const line of newEvents) {
			term.write(`\x1b[2m${line}\x1b[0m\r\n`)
		}
		eventsWrittenRef.current = terminalEvents.length
	}, [terminalEvents])

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
