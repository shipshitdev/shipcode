import { Button, cn, GitPullRequest, LayoutList, Terminal } from '@shipshitdev/ui';
import { type ProjectTab, useAppStore } from '../stores/app-store';
import { InstantView } from './InstantView';
import { PullRequestsPanel } from './pull-requests/PullRequestsPanel';
import { ThreadPanel } from './ThreadPanel';

type TabIcon = React.ComponentType<{ size?: number; className?: string }>;

const PROJECT_TABS: Array<{ value: ProjectTab; label: string; icon: TabIcon }> = [
  { value: 'issues', label: 'Issues', icon: LayoutList },
  { value: 'pull-requests', label: 'Pull Requests', icon: GitPullRequest },
  { value: 'sessions', label: 'Sessions', icon: Terminal },
];

export function ProjectView() {
  const projectTab = useAppStore((state) => state.projectTab);
  const setProjectTab = useAppStore((state) => state.setProjectTab);

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
      {/* Tab strip */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5">
        {PROJECT_TABS.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant="ghost"
            className={cn(
              'h-7 gap-1.5 px-2.5 text-xs font-medium text-secondary',
              projectTab === value && 'bg-tertiary text-primary',
            )}
            onClick={() => setProjectTab(value)}
          >
            <Icon size={13} />
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 min-w-0 flex-col">
        {projectTab === 'issues' ? (
          <ThreadPanel />
        ) : projectTab === 'pull-requests' ? (
          <PullRequestsPanel />
        ) : (
          <InstantView />
        )}
      </div>
    </div>
  );
}
