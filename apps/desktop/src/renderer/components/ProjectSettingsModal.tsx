import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import log from 'electron-log/renderer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clampError,
  type ContextFileInfo,
  type AppSettings,
  type ExecutorModel,
  type Project,
  resolvePhaseModel,
  resolvePhaseModelId,
  resolvePhaseReasoningEffort,
  validateGithubProjectUrl,
} from '@shipcode/shared';
import {
  Button,
  Input,
  Label,
  Modal,
  ModalFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

const INHERIT_VALUE = '__inherit__';
const PROJECT_TABS = ['general', 'models', 'context'] as const;
const PHASES = ['planner', 'reviewer', 'executor', 'verifier'] as const;

type ProjectTab = (typeof PROJECT_TABS)[number];
type PhaseKey = (typeof PHASES)[number];
type ProjectOverrideState = Pick<
  Project,
  | 'plannerModelOverride'
  | 'reviewerModelOverride'
  | 'executorModelOverride'
  | 'verifierModelOverride'
  | 'plannerModelIdOverride'
  | 'reviewerModelIdOverride'
  | 'executorModelIdOverride'
  | 'verifierModelIdOverride'
  | 'plannerReasoningEffortOverride'
  | 'reviewerReasoningEffortOverride'
  | 'executorReasoningEffortOverride'
  | 'verifierReasoningEffortOverride'
>;

const EMPTY_OVERRIDES: ProjectOverrideState = {
  plannerModelOverride: null,
  reviewerModelOverride: null,
  executorModelOverride: null,
  verifierModelOverride: null,
  plannerModelIdOverride: null,
  reviewerModelIdOverride: null,
  executorModelIdOverride: null,
  verifierModelIdOverride: null,
  plannerReasoningEffortOverride: null,
  reviewerReasoningEffortOverride: null,
  executorReasoningEffortOverride: null,
  verifierReasoningEffortOverride: null,
};

const PROVIDER_OVERRIDE_KEYS = {
  planner: 'plannerModelOverride',
  reviewer: 'reviewerModelOverride',
  executor: 'executorModelOverride',
  verifier: 'verifierModelOverride',
} as const;

const MODEL_ID_OVERRIDE_KEYS = {
  planner: 'plannerModelIdOverride',
  reviewer: 'reviewerModelIdOverride',
  executor: 'executorModelIdOverride',
  verifier: 'verifierModelIdOverride',
} as const;

const EFFORT_OVERRIDE_KEYS = {
  planner: 'plannerReasoningEffortOverride',
  reviewer: 'reviewerReasoningEffortOverride',
  executor: 'executorReasoningEffortOverride',
  verifier: 'verifierReasoningEffortOverride',
} as const;

const PROVIDER_LABELS: Record<ExecutorModel, string> = {
  claude: 'Claude',
  codex: 'Codex',
  openrouter: 'OpenRouter',
};

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const;

const CODEX_MODELS = [
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
] as const;

const OPENROUTER_MODELS = [
  { value: 'openrouter/auto', label: 'Auto (paid)' },
  { value: 'openrouter/free', label: 'Auto (free)' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'qwen/qwen3.6-plus', label: 'Qwen 3.6 Plus' },
  { value: 'qwen/qwen3-coder:free', label: 'Qwen 3 Coder Free' },
] as const;

const PHASE_META: Array<{
  key: PhaseKey;
  label: string;
  validProviders: ExecutorModel[];
}> = [
  { key: 'planner', label: 'Planner', validProviders: ['claude', 'openrouter'] },
  { key: 'reviewer', label: 'Reviewer', validProviders: ['claude', 'codex', 'openrouter'] },
  { key: 'executor', label: 'Executor', validProviders: ['claude', 'codex', 'openrouter'] },
  { key: 'verifier', label: 'Verifier', validProviders: ['claude', 'openrouter'] },
];

function getModelOptions(
  provider: ExecutorModel,
): ReadonlyArray<{ value: string; label: string }> {
  if (provider === 'claude') return CLAUDE_MODELS;
  if (provider === 'codex') return CODEX_MODELS;
  return OPENROUTER_MODELS;
}

function buildProjectDraft(project: Project | null | undefined, overrides: ProjectOverrideState): Project | null {
  if (!project) return null;
  return { ...project, ...overrides };
}

function formatInheritedSummary(
  settings: AppSettings,
  projectDraft: Project,
  phase: PhaseKey,
): string {
  const provider = resolvePhaseModel(settings, projectDraft, phase);
  const model = resolvePhaseModelId(settings, projectDraft, phase);
  const effort = resolvePhaseReasoningEffort(settings, projectDraft, phase);
  return `${PROVIDER_LABELS[provider]}${model ? ` / ${model}` : ''} / ${effort}`;
}

function ProjectPhaseSettingsRow({
  phase,
  label,
  validProviders,
  settings,
  projectDraft,
  overrides,
  setOverrides,
}: {
  phase: PhaseKey;
  label: string;
  validProviders: ExecutorModel[];
  settings: AppSettings;
  projectDraft: Project;
  overrides: ProjectOverrideState;
  setOverrides: Dispatch<SetStateAction<ProjectOverrideState>>;
}) {
  const providerKey = PROVIDER_OVERRIDE_KEYS[phase];
  const modelIdKey = MODEL_ID_OVERRIDE_KEYS[phase];
  const effortKey = EFFORT_OVERRIDE_KEYS[phase];

  const providerOverride = overrides[providerKey];
  const modelIdOverride = overrides[modelIdKey];
  const effortOverride = overrides[effortKey];

  const effectiveProvider = resolvePhaseModel(settings, projectDraft, phase);
  const modelOptions = getModelOptions(effectiveProvider);
  const knownModelValues = new Set<string>(modelOptions.map((option) => option.value));

  return (
    <div className="rounded-md border border-border bg-secondary/50 p-3">
      <div className="mb-3">
        <div className="text-[13px] font-medium text-primary">{label}</div>
        <div className="text-[11px] text-muted">
          Inherit currently uses {formatInheritedSummary(settings, projectDraft, phase)}.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">Provider</Label>
          <Select
            value={providerOverride ?? INHERIT_VALUE}
            onValueChange={(next) => {
              setOverrides((current) => ({
                ...current,
                [providerKey]: next === INHERIT_VALUE ? null : (next as ExecutorModel),
                [modelIdKey]: null,
              }));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>Inherit</SelectItem>
              {validProviders.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {PROVIDER_LABELS[provider]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">Model</Label>
          <Select
            value={modelIdOverride ?? INHERIT_VALUE}
            onValueChange={(next) => {
              setOverrides((current) => ({
                ...current,
                [modelIdKey]: next === INHERIT_VALUE ? null : next,
              }));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>Inherit</SelectItem>
              {modelIdOverride && !knownModelValues.has(modelIdOverride) && (
                <SelectItem value={modelIdOverride}>{modelIdOverride}</SelectItem>
              )}
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">Effort</Label>
          <Select
            value={effortOverride ?? INHERIT_VALUE}
            onValueChange={(next) => {
              setOverrides((current) => ({
                ...current,
                [effortKey]: next === INHERIT_VALUE ? null : (next as Project['plannerReasoningEffortOverride']),
              }));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>Inherit</SelectItem>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export function ProjectSettingsModal() {
  const queryClient = useQueryClient();
  const {
    projectSettingsModalOpen,
    projectSettingsModalProjectId,
    closeProjectSettingsModal,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<ProjectTab>('general');
  const [urlInput, setUrlInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ProjectOverrideState>(EMPTY_OVERRIDES);
  const [contextGenerating, setContextGenerating] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{
    attached: number;
    alreadyPresent: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [relinkError, setRelinkError] = useState<string | null>(null);

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get', { projectId: projectSettingsModalProjectId! }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
    enabled: projectSettingsModalOpen,
  });

  useEffect(() => {
    if (!projectSettingsModalOpen) return;
    setActiveTab('general');
    setUrlInput(project?.githubProjectUrl ?? '');
    setOverrides({
      plannerModelOverride: project?.plannerModelOverride ?? null,
      reviewerModelOverride: project?.reviewerModelOverride ?? null,
      executorModelOverride: project?.executorModelOverride ?? null,
      verifierModelOverride: project?.verifierModelOverride ?? null,
      plannerModelIdOverride: project?.plannerModelIdOverride ?? null,
      reviewerModelIdOverride: project?.reviewerModelIdOverride ?? null,
      executorModelIdOverride: project?.executorModelIdOverride ?? null,
      verifierModelIdOverride: project?.verifierModelIdOverride ?? null,
      plannerReasoningEffortOverride: project?.plannerReasoningEffortOverride ?? null,
      reviewerReasoningEffortOverride: project?.reviewerReasoningEffortOverride ?? null,
      executorReasoningEffortOverride: project?.executorReasoningEffortOverride ?? null,
      verifierReasoningEffortOverride: project?.verifierReasoningEffortOverride ?? null,
    });
    setTouched(false);
    setSubmitError(null);
    setSyncResult(null);
    setSyncError(null);
    setContextGenerating(false);
    setContextError(null);
    setRelinkError(null);
  }, [projectSettingsModalOpen, project?.id, project?.updatedAt]);

  const validation = useMemo(() => validateGithubProjectUrl(urlInput), [urlInput]);
  const showInlineError = touched && !validation.ok;
  const projectDraft = useMemo(() => buildProjectDraft(project, overrides), [project, overrides]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) return null;
      await window.shipcode.invoke<Project>('project:set-github-project-url', {
        projectId: projectSettingsModalProjectId,
        url: validation.ok ? validation.value : null,
      });
      return window.shipcode.invoke<Project>('project:set-model-overrides', {
        projectId: projectSettingsModalProjectId,
        overrides,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
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

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) throw new Error('No project selected');
      return window.shipcode.invoke<{
        attached: number;
        alreadyPresent: number;
        failed: number;
        errors: string[];
      }>('github:sync-to-project-board', {
        projectId: projectSettingsModalProjectId,
      });
    },
    onSuccess: (result) => {
      setSyncError(null);
      setSyncResult(result);
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] sync failed', err);
      setSyncResult(null);
      setSyncError(clampError(err));
    },
  });

  const relinkMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) throw new Error('No project selected');
      const path = await window.shipcode.invoke<string | null>('dialog:open-directory');
      if (!path) return null;
      return window.shipcode.invoke<Project>('project:relink-path', {
        projectId: projectSettingsModalProjectId,
        path,
      });
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setRelinkError(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['github-issues', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['threads', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['git-branches', projectSettingsModalProjectId] });
      window.shipcode.invoke('github:refresh-issues', { projectId: updated.id }).catch(() => {});
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] relink failed', err);
      setRelinkError(clampError(err));
    },
  });

  const { data: contextFiles, refetch: refetchContext } = useQuery<ContextFileInfo[]>({
    queryKey: ['context-files', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke<ContextFileInfo[]>('context:list', {
        projectId: projectSettingsModalProjectId!,
      }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
  });

  const handleSave = () => {
    setSubmitError(null);
    setTouched(true);
    if (!validation.ok) {
      setActiveTab('general');
      return;
    }
    saveMutation.mutate();
  };

  const handleSync = () => {
    setSyncResult(null);
    setSyncError(null);
    syncMutation.mutate();
  };

  const handleGenerateContext = async () => {
    if (!projectSettingsModalProjectId) return;
    setContextGenerating(true);
    setContextError(null);
    try {
      const result = await window.shipcode.invoke<{ success: boolean; error?: string }>(
        'context:generate',
        { projectId: projectSettingsModalProjectId },
      );
      if (!result.success) setContextError(result.error ?? 'Generation failed');
      refetchContext();
    } catch (err) {
      setContextError(clampError(err));
    } finally {
      setContextGenerating(false);
    }
  };

  const inputMatchesSaved = urlInput === (project?.githubProjectUrl ?? '');
  const hasSavedUrl = !!project?.githubProjectUrl;
  const canSync = hasSavedUrl && inputMatchesSaved && !syncMutation.isPending && !saveMutation.isPending;

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
    <Modal
      open={projectSettingsModalOpen}
      onClose={closeProjectSettingsModal}
      title="Project Settings"
      className="max-w-[720px]"
      onKeyDown={handleKeyDown}
    >
      {!project || !settings || !projectDraft ? (
        <div className="text-xs text-muted">Loading project…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProjectTab)}>
            <TabsList className="mb-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="context">Context</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-secondary">Name</Label>
                  <div className="text-[13px] text-primary">{project.name}</div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-secondary">Git remote</Label>
                  <div className="truncate font-mono text-xs text-secondary">
                    {project.gitRemote ?? '(no remote)'}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-secondary">Default branch</Label>
                  <div className="font-mono text-xs text-secondary">{project.defaultBranch}</div>
                </div>
              </div>

              <div className="rounded-md border border-border bg-secondary/30 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-medium text-primary">Repository folder</div>
                    <div className="text-[11px] text-muted">
                      If you moved this repo on disk, relink the existing project instead of creating a duplicate.
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRelinkError(null);
                      relinkMutation.mutate();
                    }}
                    disabled={relinkMutation.isPending}
                  >
                    {relinkMutation.isPending ? 'Locating…' : 'Change folder…'}
                  </Button>
                </div>
                <div className="font-mono text-xs text-secondary break-all">{project.path}</div>
                {project.pathExists === false && (
                  <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
                    This path is missing. ShipCode will block issue refresh, branch reads, and pipeline actions until you relink it.
                  </div>
                )}
                {relinkError && (
                  <div className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
                    <span className="line-clamp-2">{relinkError}</span>
                  </div>
                )}
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
                  to link the Kanban <span className="font-mono">board</span> button to the real board.
                </p>
                {showInlineError && !validation.ok && (
                  <p className="text-[11px] text-danger">{validation.reason}</p>
                )}
              </div>

              <div className="rounded-md border border-border bg-secondary/30 p-3">
                <div className="mb-2 text-[12px] font-medium text-primary">Board sync</div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSync}
                      disabled={!canSync}
                      title={
                        !hasSavedUrl
                          ? 'Save a board URL first'
                          : !inputMatchesSaved
                            ? 'Save your changes before syncing'
                            : 'Add every cached issue to the board'
                      }
                    >
                      {syncMutation.isPending ? 'Syncing…' : 'Sync existing issues to board'}
                    </Button>
                    {syncResult && (
                      <span className="text-[11px] text-muted">
                        Attached {syncResult.attached}, already present {syncResult.alreadyPresent}
                        {syncResult.failed > 0 ? `, failed ${syncResult.failed}` : ''}
                      </span>
                    )}
                  </div>

                  {syncError && (
                    <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
                      <span className="line-clamp-2">{syncError}</span>
                    </div>
                  )}

                  {syncResult && syncResult.errors.length > 0 && (
                    <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
                      <div className="font-medium">
                        {syncResult.errors.length} issue{syncResult.errors.length === 1 ? '' : 's'} failed:
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {syncResult.errors.slice(0, 5).map((err) => (
                          <li key={err} className="line-clamp-1">
                            • {err}
                          </li>
                        ))}
                        {syncResult.errors.length > 5 && (
                          <li className="text-muted">(+{syncResult.errors.length - 5} more — see logs)</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="models" className="space-y-3">
              <div className="text-[11px] text-muted">
                Project overrides shadow the global defaults for this repo only. Leave any field on
                inherit to keep using the global phase setting.
              </div>
              {PHASE_META.map((phase) => (
                <ProjectPhaseSettingsRow
                  key={phase.key}
                  phase={phase.key}
                  label={phase.label}
                  validProviders={phase.validProviders}
                  settings={settings}
                  projectDraft={projectDraft}
                  overrides={overrides}
                  setOverrides={setOverrides}
                />
              ))}
            </TabsContent>

            <TabsContent value="context" className="space-y-4">
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-secondary">Context Files</Label>
                <p className="text-[11px] text-muted">
                  Teach the pipeline about your project's goals, tech stack, architecture, and
                  constraints. Generated from your repo's README, package.json, and CLAUDE.md.
                </p>
                <div className="flex flex-col gap-1.5">
                  {(['GOAL.md', 'TECH-STACK.md', 'ARCHITECTURE.md', 'CONSTRAINTS.md'] as const).map(
                    (name) => {
                      const file = contextFiles?.find((entry) => entry.name === name);
                      return (
                        <div key={name} className="flex items-center gap-2 text-xs">
                          {file?.exists ? (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                          ) : (
                            <span className="w-2 shrink-0 text-center text-muted">—</span>
                          )}
                          <span className="font-mono text-[12px] text-primary">{name}</span>
                          {file?.exists && file.size != null && (
                            <span className="ml-auto text-[11px] text-muted">
                              {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                            </span>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
                <div className="mt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleGenerateContext}
                    disabled={contextGenerating}
                  >
                    {contextGenerating ? 'Generating…' : 'Generate Context'}
                  </Button>
                </div>
                {contextError && (
                  <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
                    <span className="line-clamp-2">{contextError}</span>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {submitError && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
              <span className="line-clamp-1">{submitError}</span>
            </div>
          )}
        </div>
      )}

      <ModalFooter>
        <span className="mr-auto text-[11px] text-muted">⌘↩ to save</span>
        <Button
          variant="secondary"
          onClick={closeProjectSettingsModal}
          disabled={saveMutation.isPending}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saveMutation.isPending || (touched && !validation.ok)}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
