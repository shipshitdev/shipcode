import { Button, cn, GitPullRequest, LayoutList, Terminal, Workflow } from '@shipshitdev/ui';
import { InstantView } from '../../components/InstantView';
import { PullRequestsPanel } from '../../components/pull-requests/PullRequestsPanel';
import { ThreadPanel } from '../../components/ThreadPanel';
import { type ProjectTab, useAppStore } from '../../stores/app-store';
import { ProjectGraphTab } from './project-graph-tab';

type TabIcon = React.ComponentType<{ size?: number; className?: string }>;
const GRAPH_TAB = 'graph' as ProjectTab;

const PROJECT_TABS: Array<{ value: ProjectTab; label: string; icon: TabIcon }> = [
  { value: 'issues', label: 'Issues', icon: LayoutList },
  { value: GRAPH_TAB, label: 'Graph', icon: Workflow },
  { value: 'pull-requests', label: 'Pull Requests', icon: GitPullRequest },
  { value: 'sessions', label: 'Sessions', icon: Terminal },
];

export function ProjectView() {
  const projectTab = useAppStore((state) => state.projectTab);
  const setProjectTab = useAppStore((state) => state.setProjectTab);

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
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
        ) : projectTab === GRAPH_TAB ? (
          <ProjectGraphTab />
        ) : projectTab === 'pull-requests' ? (
          <PullRequestsPanel />
        ) : (
          <InstantView />
        )}
      </div>
    </div>
  );
}
