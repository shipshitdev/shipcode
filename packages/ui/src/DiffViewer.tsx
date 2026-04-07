import type { DiffRecord } from '@crosscode/shared'

interface DiffViewerProps {
	diffs: DiffRecord[]
	activeFile?: string
	onFileSelect?: (filePath: string) => void
}

export function DiffViewer({ diffs, activeFile, onFileSelect }: DiffViewerProps) {
	if (diffs.length === 0) {
		return (
			<div className="diff-viewer diff-viewer--empty">
				<p>No changes to display</p>
			</div>
		)
	}

	const activeDiff = diffs.find((d) => d.filePath === activeFile) ?? diffs[0]

	return (
		<div className="diff-viewer">
			<div className="diff-viewer__tabs">
				{diffs.map((diff) => (
					<button
						type="button"
						key={diff.id}
						className={`diff-viewer__tab ${diff.filePath === activeDiff?.filePath ? 'diff-viewer__tab--active' : ''}`}
						onClick={() => onFileSelect?.(diff.filePath)}
					>
						<span className={`diff-viewer__action diff-viewer__action--${diff.action}`}>
							{diff.action === 'create' ? '+' : diff.action === 'delete' ? '-' : '~'}
						</span>
						{diff.filePath.split('/').pop()}
					</button>
				))}
			</div>

			{activeDiff && (
				<div className="diff-viewer__content">
					<div className="diff-viewer__file-header">
						<code>{activeDiff.filePath}</code>
						<span className={`diff-viewer__file-action diff-viewer__file-action--${activeDiff.action}`}>
							{activeDiff.action}
						</span>
					</div>
					<pre className="diff-viewer__diff">
						{activeDiff.diffContent
							? activeDiff.diffContent.split('\n').map((line, i) => {
									let lineClass = 'diff-line'
									if (line.startsWith('+') && !line.startsWith('+++')) lineClass += ' diff-line--added'
									else if (line.startsWith('-') && !line.startsWith('---')) lineClass += ' diff-line--removed'
									else if (line.startsWith('@@')) lineClass += ' diff-line--hunk'

									return (
										<div key={i} className={lineClass}>
											{line}
										</div>
									)
								})
							: 'No diff content available'}
					</pre>
				</div>
			)}
		</div>
	)
}
