import { useEffect, useMemo, useState } from 'react';
import log from 'electron-log/renderer';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  type Project,
  validateGithubProjectUrl,
  clampError,
} from '@shipcode/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

/**
 * Per-project settings modal. V1 only edits the GitHub Projects v2 URL
 * override used by the Kanban `board` quick-link. Name, git remote, and
 * default branch are displayed read-only so the modal can grow into a
 * full settings surface as those fields become editable here.
 */
export function ProjectSettingsModal() {
  const queryClient = useQueryClient();
  const {
    projectSettingsModalOpen,
    projectSettingsModalProjectId,
    closeProjectSettingsModal,
  } = useAppStore();

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get', { projectId: projectSettingsModalProjectId! }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
  });

  const [urlInput, setUrlInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Seed the input each time the modal opens for a (possibly different) project.
  useEffect(() => {
    if (!projectSettingsModalOpen) return;
    setUrlInput(project?.githubProjectUrl ?? '');
    setTouched(false);
    setSubmitError(null);
  }, [projectSettingsModalOpen, project?.id, project?.githubProjectUrl]);

  const validation = useMemo(() => validateGithubProjectUrl(urlInput), [urlInput]);
  const showInlineError = touched && !validation.ok;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) return null;
      return window.shipcode.invoke<Project>('project:set-github-project-url', {
        projectId: projectSettingsModalProjectId,
        url: validation.ok ? validation.value : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
      closeProjectSettingsModal();
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] save failed', err);
      setSubmitError(clampError(err));
    },
  });

  const handleSave = () => {
    setSubmitError(null);
    setTouched(true);
    if (!validation.ok) return;
    saveMutation.mutate();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) closeProjectSettingsModal();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeProjectSettingsModal();
    }
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog open={projectSettingsModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[560px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        {!project ? (
          <div className="text-xs text-muted">Loading project…</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-secondary">Name</Label>
              <div className="text-[13px] text-primary">{project.name}</div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-secondary">Git remote</Label>
              <div className="font-mono text-xs text-secondary truncate">
                {project.gitRemote ?? '(no remote)'}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-secondary">Default branch</Label>
              <div className="font-mono text-xs text-secondary">{project.defaultBranch}</div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="github-project-url" className="text-xs text-secondary">
                GitHub Projects board URL
              </Label>
              <Input
                id="github-project-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="https://github.com/orgs/your-org/projects/1"
                className={showInlineError ? 'border-danger' : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted">
                Leave blank to open the repo Projects tab. Paste a full GitHub Projects v2 URL
                (org, user, or repo-scoped) to link the Kanban{' '}
                <span className="font-mono">board</span> button to your actual board.
              </p>
              {showInlineError && !validation.ok && (
                <p className="text-[11px] text-danger">{validation.reason}</p>
              )}
            </div>

            {submitError && (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
                <span className="line-clamp-1">{submitError}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={closeProjectSettingsModal}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || (touched && !validation.ok)}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
          <span className="ml-auto text-[11px] text-muted">⌘↩ to save</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
