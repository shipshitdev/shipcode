import { Activity, Button, Code2, cn, GitPullRequest, LayoutList, Terminal } from '@shipshitdev/ui';
import { ActivityHeatmap } from '../../components/heatmap/ActivityHeatmap';
import { InstantView } from '../../components/InstantView';
import { PullRequestsPanel } from '../../components/pull-requests/PullRequestsPanel';
import { ThreadPanel } from '../../components/ThreadPanel';
import { type ProjectTab, useAppStore } from '../../stores/app-store';
import { CodeBrowser } from './code-browser';
import { ProjectGitVisualizer } from './project-git-visualizer';

type TabIcon = React.ComponentType<{ size?: number; className?: string }>;

const PROJECT_TABS: Array<{ value: ProjectTab; label: string; icon: TabIcon }> = [
  { value: 'issues', label: 'Issues', icon: LayoutList },
  { value: 'git', label: 'Git', icon: GitPullRequest },
  { value: 'code', label: 'Code', icon: Code2 },
  { value: 'pull-requests', label: 'Pull Requests', icon: GitPullRequest },
  { value: 'insights', label: 'Insights', icon: Activity },
  { value: 'sessions', label: 'Sessions', icon: Terminal },
];

function ProjectInsights() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Select a project to view insights.
      </div>
    );
  }
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="rounded-xl border border-border bg-elevated p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-primary">Activity</h3>
            <p className="text-[11px] text-muted">
              Daily cost, tokens, runs, and PRs across this project.
            </p>
          </div>
        </div>
        <ActivityHeatmap scope="project" surface="project" projectId={activeProjectId} />
      </div>
    </div>
  );
}

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
        ) : projectTab === 'git' ? (
          <ProjectGitVisualizer />
        ) : projectTab === 'code' ? (
          <CodeBrowser />
        ) : projectTab === 'pull-requests' ? (
          <PullRequestsPanel />
        ) : projectTab === 'insights' ? (
          <ProjectInsights />
        ) : (
          <InstantView />
        )}
      </div>
    </div>
  );
}
