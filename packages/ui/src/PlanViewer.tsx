import type { CrossCodePlan } from '@crosscode/shared'

interface PlanViewerProps {
	plan: CrossCodePlan | null
	isEditable?: boolean
	onPlanEdit?: (plan: CrossCodePlan) => void
}

export function PlanViewer({ plan, isEditable = false, onPlanEdit }: PlanViewerProps) {
	if (!plan) {
		return (
			<div className="plan-viewer plan-viewer--empty">
				<p className="plan-viewer__placeholder">Waiting for plan generation...</p>
			</div>
		)
	}

	return (
		<div className="plan-viewer">
			<header className="plan-viewer__header">
				<h2 className="plan-viewer__title">{plan.objective}</h2>
				<div className="plan-viewer__meta">
					<span className="plan-viewer__version">v{plan.version}</span>
					<span className="plan-viewer__complexity">{plan.estimatedComplexity}</span>
				</div>
			</header>

			<section className="plan-viewer__section">
				<h3>Implementation Steps</h3>
				<ol className="plan-viewer__steps">
					{plan.steps.map((step) => (
						<li key={step.order} className="plan-viewer__step">
							<div className="plan-viewer__step-desc">{step.description}</div>
							<div className="plan-viewer__step-rationale">{step.rationale}</div>
							{step.files.length > 0 && (
								<div className="plan-viewer__step-files">
									{step.files.map((file) => (
										<code key={file} className="plan-viewer__file-tag">
											{file}
										</code>
									))}
								</div>
							)}
						</li>
					))}
				</ol>
			</section>

			<section className="plan-viewer__section">
				<h3>File Changes</h3>
				<table className="plan-viewer__files-table">
					<thead>
						<tr>
							<th>Action</th>
							<th>Path</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						{plan.files.map((file) => (
							<tr key={file.path} className={`plan-viewer__file-row plan-viewer__file-row--${file.action}`}>
								<td>
									<span className={`file-action file-action--${file.action}`}>{file.action}</span>
								</td>
								<td>
									<code>{file.path}</code>
								</td>
								<td>{file.description}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>

			{plan.acceptanceCriteria.length > 0 && (
				<section className="plan-viewer__section">
					<h3>Acceptance Criteria</h3>
					<ul className="plan-viewer__criteria">
						{plan.acceptanceCriteria.map((criteria, i) => (
							<li key={i}>{criteria}</li>
						))}
					</ul>
				</section>
			)}

			{plan.outOfScope.length > 0 && (
				<section className="plan-viewer__section">
					<h3>Out of Scope</h3>
					<ul className="plan-viewer__out-of-scope">
						{plan.outOfScope.map((item, i) => (
							<li key={i}>{item}</li>
						))}
					</ul>
				</section>
			)}

			{plan.dependencies.length > 0 && (
				<section className="plan-viewer__section">
					<h3>Dependencies</h3>
					<div className="plan-viewer__deps">
						{plan.dependencies.map((dep) => (
							<code key={dep} className="plan-viewer__dep-tag">
								{dep}
							</code>
						))}
					</div>
				</section>
			)}
		</div>
	)
}
