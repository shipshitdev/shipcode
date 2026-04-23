import { clampError, type Project } from '@shipcode/shared';
import { Button, LoadingButtonContent } from '@shipshitdev/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useAppStore } from '../stores/app-store';

export function ProjectMissingView({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const openProjectSettingsModal = useAppStore((state) => state.openProjectSettingsModal);

  const relinkProject = useMutation({
    mutationFn: async () => {
      const path = await window.shipcode.invoke<string | null>('dialog:open-directory');
      if (!path) return null;
      return window.shipcode.invoke<Project>('project:relink-path', {
        projectId: project.id,
        path,
      });
    },
    onSuccess: (updated) => {
      if (!updated) return;
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['github-issues', project.id] });
      queryClient.invalidateQueries({ queryKey: ['threads', project.id] });
      queryClient.invalidateQueries({ queryKey: ['git-branches', project.id] });
      queryClient.invalidateQueries({ queryKey: ['thread-panel-data', project.id] });
      window.shipcode
        .invoke('github:refresh-issues', { projectId: updated.id, force: true })
        .catch(() => {});
    },
    onError: (err: unknown) => {
      log.error('[ProjectMissingView] relink failed', err);
      window.alert(clampError(err));
    },
  });

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-warning/30 bg-warning/10 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warning">
          Repository Missing
        </p>
        <h2 className="mt-2 text-xl font-semibold text-primary">
          ShipCode can’t load this project from disk.
        </h2>
        <p className="mt-2 text-sm text-secondary">
          This project still exists in ShipCode, but its saved folder path no longer resolves.
          Relink the moved repository folder to keep the same project, issues, threads, and history.
        </p>
        <div className="mt-4 rounded-md border border-border bg-primary/40 px-3 py-2">
          <div className="text-[11px] text-muted">Saved path</div>
          <div className="mt-1 break-all font-mono text-xs text-primary">{project.path}</div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => relinkProject.mutate()} disabled={relinkProject.isPending}>
            <LoadingButtonContent loading={relinkProject.isPending}>
              Locate moved folder
            </LoadingButtonContent>
          </Button>
          <Button variant="secondary" onClick={() => openProjectSettingsModal(project.id)}>
            Project settings
          </Button>
        </div>
      </div>
    </div>
  );
}
