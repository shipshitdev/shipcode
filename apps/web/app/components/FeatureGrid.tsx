import { Shield, GitBranch, CheckCircle } from 'lucide-react'

const features = [
	{
		icon: Shield,
		title: 'Adversarial Review',
		description:
			'Different model families catch different blind spots. Opus plans, Codex critiques.',
	},
	{
		icon: GitBranch,
		title: 'Git Worktrees',
		description:
			'Parallel execution in isolated worktrees. No branch conflicts.',
	},
	{
		icon: CheckCircle,
		title: 'PR is the Human Gate',
		description:
			'Fully autonomous until PR creation. You stay in control.',
	},
]

export function FeatureGrid() {
	return (
		<section className="py-24 px-6">
			<div className="max-w-6xl mx-auto">
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					{features.map((feature) => (
						<div
							key={feature.title}
							className="bg-bg-secondary border border-border rounded-xl p-6"
						>
							<feature.icon className="w-8 h-8 text-accent mb-4" />
							<h3 className="text-lg font-semibold text-text-primary mb-2">
								{feature.title}
							</h3>
							<p className="text-text-secondary text-sm">
								{feature.description}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}
