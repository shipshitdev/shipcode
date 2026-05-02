import { ActivityHeatmap } from '../../components/heatmap/ActivityHeatmap';
import { InstantView } from '../../components/InstantView';
import { PullRequestsPanel } from '../../components/pull-requests/PullRequestsPanel';
import { ThreadPanel } from '../../components/ThreadPanel';
import { useAppStore } from '../../stores/app-store';
import { CodeBrowser } from './code-browser';
import { ProjectGitVisualizer } from './project-git-visualizer';

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

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
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
  );
}
