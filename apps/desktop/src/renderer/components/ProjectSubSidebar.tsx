import { Activity, Code2, GitPullRequest, LayoutList, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProjectTab } from '../stores/app-store';
import { useAppStore } from '../stores/app-store';
import { SettingsNavigation } from './SettingsNavigation';

const PROJECT_NAV_ITEMS: { key: ProjectTab; label: string; icon: ReactNode }[] = [
  { key: 'issues', label: 'Issues', icon: <LayoutList size={14} /> },
  { key: 'git', label: 'Git', icon: <GitPullRequest size={14} /> },
  { key: 'code', label: 'Code', icon: <Code2 size={14} /> },
  { key: 'pull-requests', label: 'Pull Requests', icon: <GitPullRequest size={14} /> },
  { key: 'insights', label: 'Insights', icon: <Activity size={14} /> },
  { key: 'sessions', label: 'Sessions', icon: <Terminal size={14} /> },
];

export function ProjectSubSidebar() {
  const projectTab = useAppStore((state) => state.projectTab);
  const setProjectTab = useAppStore((state) => state.setProjectTab);
  const openOverview = useAppStore((state) => state.openOverview);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);

  if (sidebarCollapsed) return null;

  return (
    <SettingsNavigation
      items={PROJECT_NAV_ITEMS}
      activeKey={projectTab}
      onSelect={setProjectTab}
      backLabel="All Projects"
      onBack={openOverview}
    />
  );
}
