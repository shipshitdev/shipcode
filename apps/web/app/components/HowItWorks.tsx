import { Tag, FileText, Search, Play, GitPullRequest } from 'lucide-react'

const steps = [
	{
		icon: Tag,
		title: 'Label Issue',
		description: 'Tag a GitHub issue to trigger the pipeline.',
	},
	{
		icon: FileText,
		title: 'Plan',
		description: 'Opus generates a detailed implementation plan.',
	},
	{
		icon: Search,
		title: 'Review',
		description: 'Codex critiques the plan and finds blind spots.',
	},
	{
		icon: Play,
		title: 'Execute',
		description: 'Code is written in an isolated worktree.',
	},
	{
		icon: GitPullRequest,
		title: 'Ship PR',
		description: 'A pull request is created for human review.',
	},
]

export function HowItWorks() {
	return (
		<section className="py-24 px-6">
			<div className="max-w-6xl mx-auto">
				<h2 className="text-3xl md:text-4xl font-bold text-center mb-16">How It Works</h2>
				<div className="grid grid-cols-1 md:grid-cols-5 gap-4">
					{steps.map((step, i) => (
						<div key={step.title} className="relative flex flex-col items-center">
							<div className="bg-bg-secondary border border-border rounded-xl p-6 text-center w-full">
								<step.icon className="w-8 h-8 text-accent mx-auto mb-3" />
								<h3 className="font-semibold text-text-primary mb-1">
									{step.title}
								</h3>
								<p className="text-sm text-text-secondary">
									{step.description}
								</p>
							</div>
							{i < steps.length - 1 && (
								<div className="hidden md:block absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 text-text-muted text-lg z-10">
									&rarr;
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	)
}
