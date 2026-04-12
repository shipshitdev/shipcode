import {
  Button,
  cn,
  Globe,
  Input,
  Lock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

interface Repo {
  name: string;
  private: boolean;
}

interface Props {
  selectedRepo: string | null;
  onSelect: (repo: string | null) => void;
}

type Visibility = 'all' | 'public' | 'private';

export function StepGitHubProject({ selectedRepo, onSelect }: Props) {
  const queryClient = useQueryClient();
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('all');
  const [search, setSearch] = useState('');

  const {
    data: repos,
    isLoading,
    error,
    refetch,
  } = useQuery<Repo[]>({
    queryKey: ['onboarding-repos'],
    queryFn: () => window.shipcode.invoke('onboarding:list-repos'),
  });

  const retry = () => {
    queryClient.invalidateQueries({ queryKey: ['onboarding-repos'] });
    refetch();
  };

  const orgs = useMemo(() => {
    if (!repos) return [];
    const owners = new Set(repos.map((r) => r.name.split('/')[0]));
    return Array.from(owners).sort();
  }, [repos]);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    return repos.filter((repo) => {
      const matchesOrg = activeOrg ? repo.name.startsWith(`${activeOrg}/`) : true;
      const matchesVisibility =
        visibility === 'all' ? true : visibility === 'private' ? repo.private : !repo.private;
      const matchesSearch = search ? repo.name.toLowerCase().includes(search.toLowerCase()) : true;
      return matchesOrg && matchesVisibility && matchesSearch;
    });
  }, [repos, activeOrg, visibility, search]);

  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-2">Connect a GitHub repository</h3>
      <p className="text-secondary text-[13px] mb-4 leading-relaxed">
        Shipcode uses GitHub issues as the PRD and work-item store, and creates pull requests on the
        selected repo. A repository is required to proceed.
      </p>

      {isLoading ? (
        <div className="py-6 text-center text-muted">Loading repositories...</div>
      ) : error ? (
        <div className="mb-3">
          <div className="rounded-md border border-[#5c1f1f] bg-[#3d1111] px-3 py-2.5 text-xs text-danger">
            Failed to load repositories. Make sure{' '}
            <code className="rounded bg-black/20 px-1 py-0.5">gh</code> is installed and
            authenticated (<code className="rounded bg-black/20 px-1 py-0.5">gh auth login</code>),
            then click Retry.
          </div>
          <Button variant="secondary" onClick={retry} className="mt-2 text-xs">
            Retry
          </Button>
        </div>
      ) : repos && repos.length > 0 ? (
        <>
          {/* Filters row */}
          <div className="flex gap-2 mb-3">
            {orgs.length > 1 && (
              <Select
                value={activeOrg ?? '__all__'}
                onValueChange={(v: string) => setActiveOrg(v === '__all__' ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue placeholder="All organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">
                    All organizations
                  </SelectItem>
                  {orgs.map((org) => (
                    <SelectItem key={org} value={org} className="text-xs">
                      {org}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={visibility}
              onValueChange={(v: string) => setVisibility(v as Visibility)}
            >
              <SelectTrigger className="h-8 text-xs w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All
                </SelectItem>
                <SelectItem value="public" className="text-xs">
                  Public
                </SelectItem>
                <SelectItem value="private" className="text-xs">
                  Private
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

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
                <Button
                  variant="ghost"
                  key={repo.name}
                  className={cn(
                    'h-auto w-full justify-start gap-2 rounded-md border px-3 py-2 font-mono text-[13px] font-normal',
                    selectedRepo === repo.name
                      ? 'border-accent bg-accent/10 text-primary'
                      : 'border-transparent bg-tertiary text-primary hover:border-text-muted',
                  )}
                  onClick={() => onSelect(repo.name)}
                >
                  {repo.private ? (
                    <Lock size={12} className="shrink-0 text-muted" />
                  ) : (
                    <Globe size={12} className="shrink-0 text-muted" />
                  )}
                  {repo.name}
                </Button>
              ))
            ) : (
              <div className="py-6 text-center text-muted">No matching repositories.</div>
            )}
          </div>
        </>
      ) : (
        <div className="py-6 text-center">
          <p className="text-muted mb-3">No repositories found for your account.</p>
          <p className="text-xs text-muted mb-3">
            Create a repository at{' '}
            <code className="rounded bg-black/20 px-1 py-0.5">github.com/new</code>, then click
            Retry.
          </p>

          <Button variant="secondary" onClick={retry} className="text-xs">
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
