import {
  clampError,
  type Project,
  type ProjectSetupDraft,
  type RepoSetupContract,
  type RepoSetupEnvFile,
} from '@shipcode/shared';
import { Badge, Button, Checkbox, Input, Label, Modal, ModalFooter, Textarea } from '@shipcode/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

type LocalEnvFile = RepoSetupEnvFile & { id: string };

function makeEnvFileId() {
  return `env-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function commandsToText(commands: string[]): string {
  return commands.join('\n');
}

function textToCommands(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeEnvFiles(envFiles: RepoSetupEnvFile[]): LocalEnvFile[] {
  return envFiles.map((file) => ({
    id: makeEnvFileId(),
    source: file.source,
    target: file.target,
    required: file.required,
  }));
}

export function ProjectSetupModal() {
  const queryClient = useQueryClient();
  const {
    projectSetupModalOpen,
    projectSetupModalProjectId,
    closeProjectSetupModal,
    activeProjectId,
  } = useAppStore();

  const [setupCommandsText, setSetupCommandsText] = useState('');
  const [verifyCommandsText, setVerifyCommandsText] = useState('');
  const [testingContext, setTestingContext] = useState('');
  const [setupBeforeVerify, setSetupBeforeVerify] = useState(false);
  const [envFiles, setEnvFiles] = useState<LocalEnvFile[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', projectSetupModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get', { projectId: projectSetupModalProjectId ?? '' }),
    enabled: !!projectSetupModalProjectId && projectSetupModalOpen,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: setupDraft, refetch } = useQuery<ProjectSetupDraft>({
    queryKey: ['project-setup', projectSetupModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get-setup', { projectId: projectSetupModalProjectId ?? '' }),
    enabled: !!projectSetupModalProjectId && projectSetupModalOpen,
    staleTime: 0,
  });

  useEffect(() => {
    if (!projectSetupModalOpen || !setupDraft) return;
    const contract = setupDraft.inspection.contract ?? setupDraft.suggestedContract;
    setSetupCommandsText(commandsToText(contract.setupCommands));
    setVerifyCommandsText(commandsToText(contract.verifyCommands));
    setTestingContext(contract.testingContext ?? '');
    setSetupBeforeVerify(contract.setupBeforeVerify);
    setEnvFiles(normalizeEnvFiles(contract.envFiles));
    setSubmitError(null);
  }, [projectSetupModalOpen, setupDraft]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectSetupModalProjectId) throw new Error('Missing project id');
      const contract: RepoSetupContract = {
        version: 1,
        setupCommands: textToCommands(setupCommandsText),
        verifyCommands: textToCommands(verifyCommandsText),
        envFiles: envFiles
          .map((file) => ({
            source: file.source.trim(),
            target: file.target?.trim() || undefined,
            required: file.required,
          }))
          .filter((file) => file.source.length > 0),
        setupBeforeVerify,
        testingContext: testingContext.trim() || null,
      };
      return window.shipcode.invoke('project:save-setup', {
        projectId: projectSetupModalProjectId,
        contract,
      });
    },
    onSuccess: async () => {
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['projects-visible'] }),
        queryClient.invalidateQueries({ queryKey: ['projects-archived'] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectSetupModalProjectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-setup', projectSetupModalProjectId] }),
      ]);
      closeProjectSetupModal();
    },
    onError: (error) => {
      setSubmitError(clampError(error));
    },
  });

  const detectedProfiles = useMemo(() => setupDraft?.profiles ?? [], [setupDraft]);
  const inspection = setupDraft?.inspection ?? null;

  const addEnvFile = () =>
    setEnvFiles((prev) => [
      ...prev,
      { id: makeEnvFileId(), source: '', target: undefined, required: true },
    ]);

  const updateEnvFile = (id: string, patch: Partial<RepoSetupEnvFile>) =>
    setEnvFiles((prev) => prev.map((file) => (file.id === id ? { ...file, ...patch } : file)));

  const removeEnvFile = (id: string) =>
    setEnvFiles((prev) => prev.filter((file) => file.id !== id));

  const handleSkip = () => {
    closeProjectSetupModal();
  };

  const title =
    inspection?.status === 'configured'
      ? `Project Setup: ${project?.name ?? 'Project'}`
      : `Configure Project Setup: ${project?.name ?? 'Project'}`;

  return (
    <Modal
      open={projectSetupModalOpen}
      onClose={closeProjectSetupModal}
      title={title}
      className="max-w-[760px]"
    >
      <div className="flex flex-col gap-4">
        {inspection?.status === 'invalid' ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            Existing setup file is invalid: {inspection.error}
          </div>
        ) : null}

        {inspection?.status === 'missing' ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            This project has no repo setup contract yet. ShipCode will keep using global fallback
            testing settings until you save one.
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <div className="mb-2 text-[12px] font-medium text-primary">Detected project profiles</div>
          <div className="flex flex-wrap gap-2">
            {detectedProfiles.map((profile: ProjectSetupDraft['profiles'][number]) => (
              <Badge
                key={`${profile.kind}:${profile.evidence.join('|')}`}
                variant={profile.recommended ? 'accent' : 'default'}
                className="gap-1"
              >
                {profile.label}
                {profile.recommended ? ' recommended' : ''}
              </Badge>
            ))}
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted">
            {detectedProfiles.map((profile: ProjectSetupDraft['profiles'][number]) => (
              <div key={`${profile.kind}:evidence`}>
                {profile.label}: {profile.evidence.join(', ')}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="setup-commands" className="text-xs text-secondary">
              Setup commands
            </Label>
            <Textarea
              id="setup-commands"
              value={setupCommandsText}
              onChange={(e) => setSetupCommandsText(e.target.value)}
              placeholder="One shell command per line"
              rows={6}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="verify-commands" className="text-xs text-secondary">
              Verify commands
            </Label>
            <Textarea
              id="verify-commands"
              value={verifyCommandsText}
              onChange={(e) => setVerifyCommandsText(e.target.value)}
              placeholder="One shell command per line"
              rows={6}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="testing-context" className="text-xs text-secondary">
            Testing context
          </Label>
          <Textarea
            id="testing-context"
            value={testingContext}
            onChange={(e) => setTestingContext(e.target.value)}
            placeholder="Explain the repo's test conventions, frameworks, and any caveats."
            rows={4}
          />
        </div>

        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-primary">Env files</div>
              <div className="text-[11px] text-muted">
                Files copied from repo root into the worktree before execution.
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={addEnvFile}>
              Add env file
            </Button>
          </div>

          <div className="space-y-3">
            {envFiles.length === 0 ? (
              <div className="text-[11px] text-muted">No env files configured.</div>
            ) : null}

            {envFiles.map((file) => (
              <div
                key={file.id}
                className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto_auto]"
              >
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-secondary">Source</Label>
                  <Input
                    value={file.source}
                    onChange={(e) => updateEnvFile(file.id, { source: e.target.value })}
                    placeholder=".env.local"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-secondary">Target</Label>
                  <Input
                    value={file.target ?? ''}
                    onChange={(e) =>
                      updateEnvFile(file.id, { target: e.target.value || undefined })
                    }
                    placeholder="Optional alternate target path"
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-[11px] text-secondary">
                  <Checkbox
                    checked={file.required}
                    onCheckedChange={(checked) =>
                      updateEnvFile(file.id, { required: checked === true })
                    }
                  />
                  Required
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-end"
                  onClick={() => removeEnvFile(file.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-secondary">
          <Checkbox
            checked={setupBeforeVerify}
            onCheckedChange={(checked) => setSetupBeforeVerify(checked === true)}
          />
          Rerun setup commands before verification commands
        </label>

        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <div className="text-[12px] font-medium text-primary">Target file</div>
          <div className="mt-1 font-mono text-[11px] text-secondary">
            {inspection?.path ?? '.shipcode/setup.json'}
          </div>
          {activeProjectId === projectSetupModalProjectId ? null : (
            <div className="mt-1 text-[11px] text-muted">
              Setup is stored in the repo, not in ShipCode's database.
            </div>
          )}
        </div>

        {submitError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {submitError}
          </div>
        ) : null}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={handleSkip}>
          Skip for now
        </Button>
        <Button variant="secondary" onClick={() => refetch()}>
          Re-detect
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save setup'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
