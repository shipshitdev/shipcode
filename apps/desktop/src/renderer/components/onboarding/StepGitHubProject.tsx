import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Input, Button } from '@shipcode/ui'

interface Props {
	selectedRepo: string | null
	onSelect: (repo: string | null) => void
}

export function StepGitHubProject({ selectedRepo, onSelect }: Props) {
	const queryClient = useQueryClient()
	const [activeOrg, setActiveOrg] = useState<string | null>(null)
	const [search, setSearch] = useState('')

	const { data: repos, isLoading, error, refetch } = useQuery<string[]>({
		queryKey: ['onboarding-repos'],
		queryFn: () => window.shipcode.invoke('onboarding:list-repos'),
	})

	const retry = () => {
		queryClient.invalidateQueries({ queryKey: ['onboarding-repos'] })
		refetch()
	}

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
		<div>
			<h3 className="text-[15px] font-semibold mb-2">Connect a GitHub repository</h3>
			<p className="text-text-secondary text-[13px] mb-4 leading-relaxed">
				Shipcode uses GitHub issues as the PRD and work-item store, and creates pull
				requests on the selected repo. A repository is required to proceed.
			</p>

			{isLoading ? (
				<div className="py-6 text-center text-text-muted">Loading repositories...</div>
			) : error ? (
				<div className="mb-3">
					<div className="rounded-md border border-[#5c1f1f] bg-[#3d1111] px-3 py-2.5 text-xs text-danger">
						Failed to load repositories. Make sure <code className="rounded bg-black/20 px-1 py-0.5">gh</code> is installed and authenticated (<code className="rounded bg-black/20 px-1 py-0.5">gh auth login</code>), then click Retry.
					</div>
					<Button variant="secondary" onClick={retry} className="mt-2 text-xs">
						Retry
					</Button>
				</div>
			) : repos && repos.length > 0 ? (
				<>
					{/* Org selector tabs */}
					{orgs.length > 1 && (
						<div className="flex gap-1 mb-3">
							<button
								type="button"
								className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
									activeOrg === null
										? 'bg-accent text-bg-primary'
										: 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
								}`}
								onClick={() => setActiveOrg(null)}
							>
								All
							</button>
							{orgs.map((org) => (
								<button
									type="button"
									key={org}
									className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
										activeOrg === org
											? 'bg-accent text-bg-primary'
											: 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
									}`}
									onClick={() => setActiveOrg(org)}
								>
									{org}
								</button>
							))}
						</div>
					)}

					{/* Search */}
					<Input
						type="text"
						placeholder="Search repositories..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="mb-3"
					/>

					{/* Repo list */}
					<div className="flex flex-col gap-1 max-h-60 overflow-y-auto mb-3">
						{filteredRepos.length > 0 ? (
							filteredRepos.map((repo) => (
								<button
									type="button"
									key={repo}
									className={`block w-full text-left rounded-md px-3 py-2 font-mono text-[13px] cursor-pointer transition-colors border ${
										selectedRepo === repo
											? 'border-accent bg-accent/10 text-text-primary'
											: 'border-transparent bg-bg-tertiary text-text-primary hover:border-text-muted'
									}`}
									onClick={() => onSelect(repo)}
								>
									{repo}
								</button>
							))
						) : (
							<div className="py-6 text-center text-text-muted">No matching repositories.</div>
						)}
					</div>
				</>
			) : (
				<div className="py-6 text-center">
					<p className="text-text-muted mb-3">No repositories found for your account.</p>
					<p className="text-xs text-text-muted mb-3">
						Create a repository at <code className="rounded bg-black/20 px-1 py-0.5">github.com/new</code>, then click Retry.
					</p>
					<Button variant="secondary" onClick={retry} className="text-xs">
						Retry
					</Button>
				</div>
			)}
		</div>
	)
}
