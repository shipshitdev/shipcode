import { PageHeader } from '@shipcode/ui';
import { Button } from '@shipshitdev/ui';
import { Folder } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

export function NoProjectView() {
  const openAddProjectExplorer = useAppStore((state) => state.openAddProjectExplorer);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-primary" data-testid="no-project-view">
      <PageHeader
        title="No project selected"
        subtitle="Pick a project in the sidebar to open its board and issues."
      />
      <div className="flex flex-1 flex-col items-start justify-center gap-4 px-8">
        <p className="max-w-md text-[13px] leading-6 text-secondary">
          Workspace views like Overview and Inbox work without a repo. Board, Git, and the issue
          list need a project.
        </p>
        <Button type="button" onClick={() => openAddProjectExplorer()}>
          <Folder size={14} />
          Add repository
        </Button>
      </div>
    </div>
  );
}
