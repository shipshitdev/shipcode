export function CodeWindow() {
	return (
		<section className="py-24 px-6">
			<div className="max-w-3xl mx-auto">
				<div className="bg-secondary border border-border rounded-xl overflow-hidden">
					{/* Title bar */}
					<div className="flex items-center gap-2 px-4 py-3 bg-tertiary border-b border-border">
						<span className="w-3 h-3 rounded-full bg-danger" />
						<span className="w-3 h-3 rounded-full bg-warning" />
						<span className="w-3 h-3 rounded-full bg-success" />
						<span className="ml-3 text-sm text-muted font-mono">
							shipcode run 42
						</span>
					</div>
					{/* Terminal content */}
					<pre className="px-6 py-5 font-mono text-sm leading-relaxed overflow-x-auto">
						<Line text="Fetching issue #42..." />
						<Line text="Issue: Add dark mode toggle" />
						<Line text="Model: claude" />
						<Line text="" />
						<Line text="Planning..." />
						<Line text="Plan generated (3 steps, 4 files)" check />
						<Line text="" />
						<Line text="Reviewing..." />
						<Line text="Codex found 2 issues (1 major, 1 minor)" warn />
						<Line text="" />
						<Line text="Revising..." />
						<Line text="Plan revised" check />
						<Line text="" />
						<Line text="Reviewing..." />
						<Line text="Codex approved" check />
						<Line text="" />
						<Line text="Executing..." />
						<Line text="Implementation complete" check />
						<Line text="" />
						<Line text="Shipping..." />
						<Line
							text="PR #43 created → github.com/acme/app/pull/43"
							check
						/>
					</pre>
				</div>
			</div>
		</section>
	)
}

function Line({
	text,
	check,
	warn,
}: { text: string; check?: boolean; warn?: boolean }) {
	if (!text) return <span className="block h-5" />

	const prefix = check ? (
		<span className="text-success">{'✓ '}</span>
	) : warn ? (
		<span className="text-warning">{'⚠ '}</span>
	) : null

	return (
		<span className="block text-secondary">
			{prefix}
			{text}
		</span>
	)
}
