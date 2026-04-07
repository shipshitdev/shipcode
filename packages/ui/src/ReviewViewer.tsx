import type { PlanReview, ReviewFinding } from '@crosscode/shared'

interface ReviewViewerProps {
	review: PlanReview | null
}

const SEVERITY_COLORS: Record<ReviewFinding['severity'], string> = {
	critical: '#ef4444',
	major: '#f97316',
	minor: '#eab308',
	nit: '#9ca3af',
}

export function ReviewViewer({ review }: ReviewViewerProps) {
	if (!review) {
		return (
			<div className="review-viewer review-viewer--empty">
				<p className="review-viewer__placeholder">Waiting for review...</p>
			</div>
		)
	}

	const decisionClass = `review-viewer__decision review-viewer__decision--${review.decision}`

	return (
		<div className="review-viewer">
			<header className="review-viewer__header">
				<span className={decisionClass}>{review.decision.replace('_', ' ')}</span>
				<span className="review-viewer__confidence">Confidence: {review.confidence}</span>
			</header>

			<p className="review-viewer__summary">{review.summary}</p>

			{review.findings.length > 0 && (
				<section className="review-viewer__findings">
					<h3>Findings ({review.findings.length})</h3>
					{review.findings.map((finding) => (
						<div
							key={finding.id}
							className="review-viewer__finding"
							style={{ borderLeftColor: SEVERITY_COLORS[finding.severity] }}
						>
							<div className="review-viewer__finding-header">
								<span
									className="review-viewer__severity"
									style={{ color: SEVERITY_COLORS[finding.severity] }}
								>
									{finding.severity.toUpperCase()}
								</span>
								<span className="review-viewer__finding-id">{finding.id}</span>
								<span className="review-viewer__category">{finding.category}</span>
							</div>
							<p className="review-viewer__finding-desc">{finding.description}</p>
							{finding.filePath && (
								<code className="review-viewer__finding-file">{finding.filePath}</code>
							)}
							{finding.suggestion && (
								<div className="review-viewer__suggestion">
									<strong>Suggestion:</strong> {finding.suggestion}
								</div>
							)}
						</div>
					))}
				</section>
			)}

			{review.suggestedChanges.length > 0 && (
				<section className="review-viewer__changes">
					<h3>Suggested Changes</h3>
					<ul>
						{review.suggestedChanges.map((change, i) => (
							<li key={i}>{change}</li>
						))}
					</ul>
				</section>
			)}
		</div>
	)
}
