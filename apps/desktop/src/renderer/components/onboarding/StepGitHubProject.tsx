import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

interface Props {
	selectedRepo: string | null
	onSelect: (repo: string | null) => void
}

export function StepGitHubProject({ selectedRepo, onSelect }: Props) {
	const [activeOrg, setActiveOrg] = useState<string | null>(null)
	const [search, setSearch] = useState('')

	const { data: repos, isLoading, error } = useQuery<string[]>({
		queryKey: ['onboarding-repos'],
		queryFn: () => window.shipcode.invoke('onboarding:list-repos'),
	})

	// Extract unique orgs/owners from repos
	const orgs = useMemo(() => {
		if (!repos) return []
		const owners = new Set(repos.map((r) => r.split('/')[0]))
		return Array.from(owners).sort()
	}, [repos])

	// Filter repos by active org and search query
	const filteredRepos = useMemo(() => {
		if (!repos) return []
		return repos.filter((repo) => {
			const matchesOrg = activeOrg ? repo.startsWith(`${activeOrg}/`) : true
			const matchesSearch = search ? repo.toLowerCase().includes(search.toLowerCase()) : true
			return matchesOrg && matchesSearch
		})
	}, [repos, activeOrg, search])

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
				<>
					{/* Org selector */}
					{orgs.length > 1 && (
						<div className="onboarding__org-tabs">
							<button
								type="button"
								className={`onboarding__org-tab ${activeOrg === null ? 'onboarding__org-tab--active' : ''}`}
								onClick={() => setActiveOrg(null)}
							>
								All
							</button>
							{orgs.map((org) => (
								<button
									type="button"
									key={org}
									className={`onboarding__org-tab ${activeOrg === org ? 'onboarding__org-tab--active' : ''}`}
									onClick={() => setActiveOrg(org)}
								>
									{org}
								</button>
							))}
						</div>
					)}

					{/* Search */}
					<input
						type="text"
						className="onboarding__search"
						placeholder="Search repositories..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>

					{/* Repo list */}
					<div className="onboarding__repo-list">
						{filteredRepos.length > 0 ? (
							filteredRepos.map((repo) => (
								<button
									type="button"
									key={repo}
									className={`onboarding__repo-item ${selectedRepo === repo ? 'onboarding__repo-item--selected' : ''}`}
									onClick={() => onSelect(repo)}
								>
									{repo}
								</button>
							))
						) : (
							<div className="onboarding__empty">No matching repositories.</div>
						)}
					</div>
				</>
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
