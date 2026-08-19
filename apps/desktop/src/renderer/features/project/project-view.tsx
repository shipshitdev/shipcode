import { ConversationHome } from '../../components/ConversationHome';
import { IssuesPanel } from '../../components/IssuesPanel';
import { PullRequestsPanel } from '../../components/pull-requests/PullRequestsPanel';
import { TerminalView } from '../../components/TerminalView';
import { useAppStore } from '../../stores/app-store';
import { CodeBrowser } from './code-browser';
import { ProjectInsights } from './ProjectInsights';
import { ProjectGitVisualizer } from './project-git-visualizer';

export function ProjectView() {
  const projectTab = useAppStore((state) => state.projectTab);

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
      {projectTab === 'conversations' ? (
        <ConversationHome />
      ) : projectTab === 'issues' ? (
        <IssuesPanel />
      ) : projectTab === 'git' ? (
        <ProjectGitVisualizer />
      ) : projectTab === 'code' ? (
        <CodeBrowser />
      ) : projectTab === 'pull-requests' ? (
        <PullRequestsPanel />
      ) : projectTab === 'insights' ? (
        <ProjectInsights />
      ) : (
        <TerminalView />
      )}
    </div>
  );
}
