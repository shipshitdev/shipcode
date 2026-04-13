import type { Project } from '@shipcode/shared';
import { Alert, AlertDescription } from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

type ProjectWithPathState = Project & { pathExists?: boolean };

export function ProjectPathBanner({ project }: { project: ProjectWithPathState | null }) {
  const { settingsVisible } = useAppStore();

  if (settingsVisible || !project || project.pathExists !== false) return null;

  return (
    <Alert
      variant="warning"
      className="flex items-center gap-2 rounded-none border-x-0 border-t-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs"
    >
      <span className="text-base font-bold leading-none">!</span>
      <AlertDescription className="text-xs text-warning">
        <span className="font-medium">{project.name}</span> points to a folder that no longer
        exists: <span className="font-mono">{project.path}</span>. Issue refresh, branch reads, and
        pipeline runs will fail until you relink the project to the moved repository folder.
      </AlertDescription>
    </Alert>
  );
}
