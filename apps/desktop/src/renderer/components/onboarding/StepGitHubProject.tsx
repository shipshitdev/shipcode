import { useQuery } from '@tanstack/react-query'

interface Props {
	selectedRepo: string | null
	onSelect: (repo: string | null) => void
}

export function StepGitHubProject({ selectedRepo, onSelect }: Props) {
	const { data: repos, isLoading, error } = useQuery<string[]>({
		queryKey: ['onboarding-repos'],
		queryFn: () => window.shipcode.invoke('onboarding:list-repos'),
	})

	return (
		<div className="onboarding__step">
			<h3>Connect a GitHub repository</h3>
			<p className="onboarding__description">
				Select a repository to enable issue polling and automated PR creation.
			</p>

			{isLoading ? (
				<div className="onboarding__loading">Loading repositories...</div>
			) : error ? (
				<div className="onboarding__error">
					Failed to load repositories. Make sure <code>gh</code> is authenticated.
				</div>
			) : repos && repos.length > 0 ? (
				<div className="onboarding__repo-list">
					{repos.map((repo) => (
						<button
							type="button"
							key={repo}
							className={`onboarding__repo-item ${selectedRepo === repo ? 'onboarding__repo-item--selected' : ''}`}
							onClick={() => onSelect(repo)}
						>
							{repo}
						</button>
					))}
				</div>
			) : (
				<div className="onboarding__empty">No repositories found.</div>
			)}

			<button
				type="button"
				className="btn btn--ghost onboarding__skip"
				onClick={() => onSelect(null)}
			>
				Skip GitHub setup
			</button>
		</div>
	)
}
