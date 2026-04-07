import type { VerificationResult } from '@crosscode/shared'

interface VerificationViewerProps {
	verification: VerificationResult
}

export function VerificationViewer({ verification }: VerificationViewerProps) {
	return (
		<div className="verification-viewer">
			<div className="verification-viewer__header">
				<span className={`verification-viewer__badge verification-viewer__badge--${verification.result}`}>
					{verification.result === 'passed' ? '✓ Passed' : '✗ Failed'}
				</span>
			</div>

			<p className="verification-viewer__summary">{verification.summary}</p>

			{verification.criteriaResults.length > 0 && (
				<div className="verification-viewer__section">
					<h4>Acceptance Criteria</h4>
					<ul className="verification-viewer__criteria">
						{verification.criteriaResults.map((cr, i) => (
							<li key={i} className={`verification-viewer__criterion verification-viewer__criterion--${cr.passed ? 'passed' : 'failed'}`}>
								<span className="verification-viewer__criterion-status">
									{cr.passed ? '✓' : '✗'}
								</span>
								<div>
									<div className="verification-viewer__criterion-text">{cr.criterion}</div>
									<div className="verification-viewer__criterion-evidence">{cr.evidence}</div>
								</div>
							</li>
						))}
					</ul>
				</div>
			)}

			{verification.issues.length > 0 && (
				<div className="verification-viewer__section">
					<h4>Issues ({verification.issues.length})</h4>
					<ul className="verification-viewer__issues">
						{verification.issues.map((issue, i) => (
							<li key={i} className="verification-viewer__issue">
								<span className={`verification-viewer__severity verification-viewer__severity--${issue.severity}`}>
									{issue.severity}
								</span>
								<span>{issue.description}</span>
								{issue.filePath && <code className="verification-viewer__file">{issue.filePath}</code>}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}
