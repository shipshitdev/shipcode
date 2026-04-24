import {
  type AppSettings,
  buildProjectModelPresetOverrides,
  clampError,
  type IntegrationStatus,
  type ModelConfigPresetKey,
  type OpenRouterModelValidation,
  type Project,
  type ProjectSetupDraft,
  type RepoMemoryStatus,
  type RepoSetupContract,
  type RepoSetupEnvFile,
  validateGithubProjectUrl,
} from '@shipcode/shared';
import {
  Bell,
  Button,
  Code2,
  FolderGit,
  Keycap,
  LoadingButtonContent,
  Modal,
  ModalFooter,
  Settings,
  Terminal,
  Workflow,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { ProjectSettingsContextTab } from './project-settings-modal/ProjectSettingsContextTab';
import { ProjectSettingsGeneralTab } from './project-settings-modal/ProjectSettingsGeneralTab';
import { ProjectSettingsGitHubTab } from './project-settings-modal/ProjectSettingsGitHubTab';
import { ProjectSettingsModelsTab } from './project-settings-modal/ProjectSettingsModelsTab';
import { ProjectSettingsNotificationsTab } from './project-settings-modal/ProjectSettingsNotificationsTab';
import { ProjectSettingsPipelineTab } from './project-settings-modal/ProjectSettingsPipelineTab';
import { ProjectSettingsSetupTab } from './project-settings-modal/ProjectSettingsSetupTab';
import {
  commandsToText,
  type LocalEnvFile,
  makeEnvFileId,
  normalizeEnvFiles,
  textToCommands,
} from './project-settings-modal/setup-utils';
import {
  buildProjectDraft,
  type ContextGeneratorCli,
  EMPTY_OVERRIDES,
  type PhaseKey,
  PROJECT_TABS,
  type ProjectOverrideState,
  type ProjectTab,
} from './project-settings-modal/shared';
import { SettingsNavigation, type SettingsNavigationItem } from './SettingsNavigation';

const PROJECT_SETTINGS_SECTIONS = [
  {
    key: 'general',
    label: 'General',
    icon: <Settings size={14} />,
  },
  {
    key: 'setup',
    label: 'Setup',
    icon: <Terminal size={14} />,
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    icon: <Workflow size={14} />,
  },
  {
    key: 'models',
    label: 'Models',
    icon: <Code2 size={14} />,
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: <FolderGit size={14} />,
  },
  {
    key: 'context',
    label: 'Memory',
    icon: <Code2 size={14} />,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: <Bell size={14} />,
  },
] satisfies readonly SettingsNavigationItem<ProjectTab>[];

export function ProjectSettingsModal() {
  const queryClient = useQueryClient();
  const projectSettingsModalOpen = useAppStore((state) => state.projectSettingsModalOpen);
  const projectSettingsModalProjectId = useAppStore((state) => state.projectSettingsModalProjectId);
  const projectSettingsModalInitialTab = useAppStore(
    (state) => state.projectSettingsModalInitialTab,
  );
  const closeProjectSettingsModal = useAppStore((state) => state.closeProjectSettingsModal);

  const [activeTab, setActiveTab] = useState<ProjectTab>('general');
  const [nameInput, setNameInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ProjectOverrideState>(EMPTY_OVERRIDES);
  const [contextGenerating, setContextGenerating] = useState(false);
  const [contextGeneratorCli, setContextGeneratorCli] = useState<ContextGeneratorCli>('claude');
  const [contextError, setContextError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{
    attached: number;
    alreadyPresent: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const [issueOverrideResetResult, setIssueOverrideResetResult] = useState<string | null>(null);
  const [issueOverrideResetError, setIssueOverrideResetError] = useState<string | null>(null);
  const [modelValidation, setModelValidation] = useState<
    Partial<Record<PhaseKey, OpenRouterModelValidation | null>>
  >({});
  const [notifyGithubUser, setNotifyGithubUser] = useState('');

  // Setup tab state
  const [setupCommandsText, setSetupCommandsText] = useState('');
  const [verifyCommandsText, setVerifyCommandsText] = useState('');
  const [testingContext, setTestingContext] = useState('');
  const [setupBeforeVerify, setSetupBeforeVerify] = useState(false);
  const [envFiles, setEnvFiles] = useState<LocalEnvFile[]>([]);
  const [setupSaveError, setSetupSaveError] = useState<string | null>(null);

  // Track open transition to apply initialTab only once
  const prevOpenRef = useRef(false);

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get', { projectId: projectSettingsModalProjectId ?? '' }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
    enabled: projectSettingsModalOpen,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: integrationStatus } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    enabled: projectSettingsModalOpen,
    staleTime: 30_000,
  });

  const {
    data: projectSetup,
    refetch: refetchSetup,
    isFetching: setupDetectPending,
  } = useQuery<ProjectSetupDraft>({
    queryKey: ['project-setup', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get-setup', {
        projectId: projectSettingsModalProjectId ?? '',
      }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
    staleTime: 0,
  });

  // Seed all state on open transition
  useEffect(() => {
    const isOpening = projectSettingsModalOpen && !prevOpenRef.current;
    prevOpenRef.current = projectSettingsModalOpen;

    if (!projectSettingsModalOpen) return;

    if (isOpening) {
      const tab = projectSettingsModalInitialTab;
      const isValidTab = tab && (PROJECT_TABS as readonly string[]).includes(tab);
      setActiveTab(isValidTab ? (tab as ProjectTab) : 'general');
    }

    setUrlInput(project?.githubProjectUrl ?? '');
    setNameInput(project?.name ?? '');
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
      revisionCountOverride: project?.revisionCountOverride ?? null,
      requireApprovalOverride: project?.requireApprovalOverride ?? null,
      discordRouting: project?.discordRouting ?? 'inherit',
      discordWebhookUrlOverride: project?.discordWebhookUrlOverride ?? null,
      telegramRouting: project?.telegramRouting ?? 'inherit',
      telegramChatIdOverride: project?.telegramChatIdOverride ?? null,
    });
    setNotifyGithubUser(project?.notifyGithubUser ?? '');
    setTouched(false);
    setSubmitError(null);
    setSetupSaveError(null);
    setSyncResult(null);
    setSyncError(null);
    setContextGenerating(false);
    setContextGeneratorCli('claude');
    setContextError(null);
    setRelinkError(null);
    setIssueOverrideResetResult(null);
    setIssueOverrideResetError(null);
    setModelValidation({});
  }, [
    projectSettingsModalOpen,
    projectSettingsModalInitialTab,
    project?.executorModelIdOverride,
    project?.executorModelOverride,
    project?.executorReasoningEffortOverride,
    project?.discordRouting,
    project?.discordWebhookUrlOverride,
    project?.githubProjectUrl,
    project?.name,
    project?.notifyGithubUser,
    project?.plannerModelIdOverride,
    project?.plannerModelOverride,
    project?.plannerReasoningEffortOverride,
    project?.revisionCountOverride,
    project?.requireApprovalOverride,
    project?.reviewerModelIdOverride,
    project?.reviewerModelOverride,
    project?.reviewerReasoningEffortOverride,
    project?.verifierModelIdOverride,
    project?.verifierModelOverride,
    project?.verifierReasoningEffortOverride,
    project?.telegramRouting,
    project?.telegramChatIdOverride,
  ]);

  // Seed setup state from setup draft
  useEffect(() => {
    if (!projectSettingsModalOpen || !projectSetup) return;
    const contract = projectSetup.inspection.contract ?? projectSetup.suggestedContract;
    setSetupCommandsText(commandsToText(contract.setupCommands));
    setVerifyCommandsText(commandsToText(contract.verifyCommands));
    setTestingContext(contract.testingContext ?? '');
    setSetupBeforeVerify(contract.setupBeforeVerify);
    setEnvFiles(normalizeEnvFiles(contract.envFiles));
    setSetupSaveError(null);
  }, [projectSettingsModalOpen, projectSetup]);

  const validation = useMemo(() => validateGithubProjectUrl(urlInput), [urlInput]);
  const normalizedName = nameInput.trim();
  const nameError = normalizedName.length === 0 ? 'Project name is required' : null;
  const showInlineError = touched && !validation.ok;
  const projectDraft = useMemo(() => buildProjectDraft(project, overrides), [project, overrides]);

  const detectedProfiles = useMemo(() => projectSetup?.profiles ?? [], [projectSetup]);
  const setupInspection = projectSetup?.inspection ?? null;

  // Env file handlers
  const addEnvFile = useCallback(
    () =>
      setEnvFiles((prev) => [
        ...prev,
        { id: makeEnvFileId(), source: '', target: undefined, required: true },
      ]),
    [],
  );

  const updateEnvFile = useCallback(
    (id: string, patch: Partial<RepoSetupEnvFile>) =>
      setEnvFiles((prev) => prev.map((file) => (file.id === id ? { ...file, ...patch } : file))),
    [],
  );

  const removeEnvFile = useCallback(
    (id: string) => setEnvFiles((prev) => prev.filter((file) => file.id !== id)),
    [],
  );

  const applySetupContract = useCallback((contract: RepoSetupContract) => {
    setSetupCommandsText(commandsToText(contract.setupCommands));
    setVerifyCommandsText(commandsToText(contract.verifyCommands));
    setTestingContext(contract.testingContext ?? '');
    setSetupBeforeVerify(contract.setupBeforeVerify);
    setEnvFiles(normalizeEnvFiles(contract.envFiles));
    setSetupSaveError(null);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) return null;
      await window.shipcode.invoke<Project>('project:set-name', {
        projectId: projectSettingsModalProjectId,
        name: normalizedName,
      });
      await window.shipcode.invoke<Project>('project:set-github-project-url', {
        projectId: projectSettingsModalProjectId,
        url: validation.ok ? validation.value : null,
      });
      await window.shipcode.invoke<Project>('project:set-notification-routing', {
        projectId: projectSettingsModalProjectId,
        routing: {
          discordRouting: overrides.discordRouting,
          discordWebhookUrlOverride: overrides.discordWebhookUrlOverride,
          telegramRouting: overrides.telegramRouting,
          telegramChatIdOverride: overrides.telegramChatIdOverride,
        },
      });
      await window.shipcode.invoke<Project>('project:set-notify-github-user', {
        projectId: projectSettingsModalProjectId,
        handle: notifyGithubUser.trim() || null,
      });
      return window.shipcode.invoke<Project>('project:set-model-overrides', {
        projectId: projectSettingsModalProjectId,
        overrides,
      });
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] save failed', err);
      setSubmitError(clampError(err));
    },
  });

  const setupSaveMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) throw new Error('Missing project id');
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
        projectId: projectSettingsModalProjectId,
        contract,
      });
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] setup save failed', err);
      setSetupSaveError(clampError(err));
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
      setSyncResult(null);
      setSyncError(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['github-issues', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['threads', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['git-branches', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({
        queryKey: ['thread-panel-data', projectSettingsModalProjectId],
      });
      window.shipcode
        .invoke('github:refresh-issues', { projectId: updated.id, force: true })
        .catch(() => {});
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] relink failed', err);
      setRelinkError(clampError(err));
    },
  });

  const resetIssueOverridesMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) throw new Error('No project selected');
      return window.shipcode.invoke<{ clearedCount: number }>(
        'github:clear-all-phase-overrides-for-project',
        {
          projectId: projectSettingsModalProjectId,
        },
      );
    },
    onSuccess: ({ clearedCount }) => {
      setIssueOverrideResetError(null);
      setIssueOverrideResetResult(
        clearedCount === 0
          ? 'No issue overrides were set.'
          : clearedCount === 1
            ? 'Reset issue overrides on 1 issue.'
            : `Reset issue overrides on ${clearedCount} issues.`,
      );
      queryClient.invalidateQueries({ queryKey: ['github-issues', projectSettingsModalProjectId] });
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] issue override reset failed', err);
      setIssueOverrideResetResult(null);
      setIssueOverrideResetError(clampError(err));
    },
  });

  const { data: memoryStatus, refetch: refetchContext } = useQuery<RepoMemoryStatus>({
    queryKey: ['memory-files', projectSettingsModalProjectId],
    queryFn: () => {
      if (!projectSettingsModalProjectId) {
        throw new Error('Missing project id for memory files');
      }
      return window.shipcode.invoke<RepoMemoryStatus>('memory:list', {
        projectId: projectSettingsModalProjectId,
      });
    },
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
  });

  const handleSave = async () => {
    setSubmitError(null);
    setSetupSaveError(null);
    setTouched(true);
    if (nameError) {
      setActiveTab('general');
      return;
    }
    if (!validation.ok) {
      setActiveTab('general');
      return;
    }
    try {
      // Sequential: DB settings first, then setup file
      await saveMutation.mutateAsync();
      if (projectSetup) {
        await setupSaveMutation.mutateAsync();
      }
      // Both succeeded — invalidate and close
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['projects-visible'] }),
        queryClient.invalidateQueries({ queryKey: ['projects-archived'] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] }),
        queryClient.invalidateQueries({
          queryKey: ['project-setup', projectSettingsModalProjectId],
        }),
      ]);
      closeProjectSettingsModal();
    } catch {
      // Errors already handled by individual mutation onError callbacks
    }
  };

  const handleApplyModelPreset = (preset: ModelConfigPresetKey) => {
    setOverrides((current) => ({
      ...current,
      ...buildProjectModelPresetOverrides(preset),
    }));
    setIssueOverrideResetResult(null);
    setIssueOverrideResetError(null);
    setModelValidation({});
  };

  const handleResetIssueOverrides = () => {
    if (!projectSettingsModalProjectId) return;
    const confirmed = window.confirm(
      'Reset all per-issue model and reasoning overrides for this project? Issues will inherit project/global settings again.',
    );
    if (!confirmed) return;
    resetIssueOverridesMutation.mutate();
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
        'memory:generate',
        { projectId: projectSettingsModalProjectId, cli: contextGeneratorCli },
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
  const syncLocked = !!syncError || (syncResult?.failed ?? 0) > 0;
  const canSync =
    hasSavedUrl &&
    inputMatchesSaved &&
    !syncLocked &&
    !syncMutation.isPending &&
    !saveMutation.isPending;
  const modalBusy = saveMutation.isPending || setupSaveMutation.isPending || contextGenerating;
  const pathExists = project?.pathExists !== false;
  const contextCliUnavailableReason =
    contextGeneratorCli === 'claude'
      ? !integrationStatus?.system.claude.available
        ? 'CLI missing'
        : !integrationStatus.system.claude.authenticated
          ? 'Not authenticated'
          : null
      : !integrationStatus?.system.codex.available
        ? 'CLI missing'
        : !integrationStatus.system.codex.authenticated
          ? 'Not authenticated'
          : null;
  const contextCliOptions: Array<{
    value: ContextGeneratorCli;
    label: string;
    disabledReason: string | null;
  }> = [
    {
      value: 'claude',
      label: 'Claude CLI',
      disabledReason: !integrationStatus?.system.claude.available
        ? 'CLI missing'
        : !integrationStatus.system.claude.authenticated
          ? 'Not authenticated'
          : null,
    },
    {
      value: 'codex',
      label: 'Codex CLI',
      disabledReason: !integrationStatus?.system.codex.available
        ? 'CLI missing'
        : !integrationStatus.system.codex.authenticated
          ? 'Not authenticated'
          : null,
    },
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !modalBusy) {
      e.preventDefault();
      closeProjectSettingsModal();
    }
    if (e.metaKey && e.key === 'Enter' && !contextGenerating) {
      e.preventDefault();
      void handleSave();
    }
  };

  const displayError = submitError ?? setupSaveError;

  return (
    <Modal
      open={projectSettingsModalOpen}
      onClose={() => {
        if (!modalBusy) closeProjectSettingsModal();
      }}
      title="Project Settings"
      className="max-w-[1040px] h-[88vh] flex flex-col overflow-hidden p-0"
      headerClassName="shrink-0 border-b border-border px-6 py-4"
      onKeyDown={handleKeyDown}
    >
      {!project || !settings || !projectDraft ? (
        <div className="px-6 py-4 text-xs text-muted">Loading project…</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SettingsNavigation
            items={PROJECT_SETTINGS_SECTIONS}
            activeKey={activeTab}
            onSelect={setActiveTab}
            className="w-[220px] min-w-[220px]"
          />

          <div className="flex min-w-0 flex-1 flex-col bg-primary">
            <div
              className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
              data-project-settings-scroll-region
            >
              <div className="max-w-2xl">
                <h3 className="mb-5">
                  {PROJECT_SETTINGS_SECTIONS.find((section) => section.key === activeTab)?.label}
                </h3>

                {activeTab === 'general' && (
                  <ProjectSettingsGeneralTab
                    project={project}
                    nameInput={nameInput}
                    setNameInput={setNameInput}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    setTouched={setTouched}
                    nameError={nameError}
                    showInlineError={showInlineError}
                    validationOk={validation.ok}
                    validationReason={validation.ok ? null : validation.reason}
                    relinkPending={relinkMutation.isPending}
                    relinkError={relinkError}
                    onRelink={() => {
                      setRelinkError(null);
                      relinkMutation.mutate();
                    }}
                    canSync={canSync}
                    syncLocked={syncLocked}
                    syncPending={syncMutation.isPending}
                    syncResult={syncResult}
                    syncError={syncError}
                    hasSavedUrl={hasSavedUrl}
                    inputMatchesSaved={inputMatchesSaved}
                    onSync={handleSync}
                  />
                )}

                {activeTab === 'setup' && (
                  <ProjectSettingsSetupTab
                    setupCommandsText={setupCommandsText}
                    setSetupCommandsText={setSetupCommandsText}
                    verifyCommandsText={verifyCommandsText}
                    setVerifyCommandsText={setVerifyCommandsText}
                    testingContext={testingContext}
                    setTestingContext={setTestingContext}
                    setupBeforeVerify={setupBeforeVerify}
                    setSetupBeforeVerify={setSetupBeforeVerify}
                    envFiles={envFiles}
                    addEnvFile={addEnvFile}
                    updateEnvFile={updateEnvFile}
                    removeEnvFile={removeEnvFile}
                    detectedProfiles={detectedProfiles}
                    inspection={setupInspection}
                    projectPath={project.path}
                    pathExists={pathExists}
                    submitError={setupSaveError}
                    onRedetect={() => {
                      void refetchSetup();
                    }}
                    onApplyDetectedProfile={(profile) => {
                      applySetupContract(profile.suggestedContract);
                    }}
                    detectPending={setupDetectPending}
                  />
                )}

                {activeTab === 'pipeline' && (
                  <ProjectSettingsPipelineTab
                    settings={settings}
                    overrides={overrides}
                    setOverrides={setOverrides}
                    onResetIssueOverrides={handleResetIssueOverrides}
                    issueOverrideResetPending={resetIssueOverridesMutation.isPending}
                    issueOverrideResetResult={issueOverrideResetResult}
                    issueOverrideResetError={issueOverrideResetError}
                  />
                )}

                {activeTab === 'models' && (
                  <ProjectSettingsModelsTab
                    settings={settings}
                    projectDraft={projectDraft}
                    overrides={overrides}
                    setOverrides={setOverrides}
                    integrationStatus={integrationStatus}
                    modelValidation={modelValidation}
                    setModelValidation={setModelValidation}
                    onApplyPreset={handleApplyModelPreset}
                  />
                )}

                {activeTab === 'github' && (
                  <ProjectSettingsGitHubTab
                    pathExists={pathExists}
                    projectId={projectSettingsModalProjectId ?? ''}
                    isActive={activeTab === 'github'}
                  />
                )}

                {activeTab === 'context' && (
                  <ProjectSettingsContextTab
                    contextFiles={memoryStatus?.files}
                    contextGeneratorCli={contextGeneratorCli}
                    setContextGeneratorCli={setContextGeneratorCli}
                    contextGenerating={contextGenerating}
                    contextCliUnavailableReason={contextCliUnavailableReason}
                    contextError={contextError}
                    cliOptions={contextCliOptions}
                    onGenerateContext={() => {
                      void handleGenerateContext();
                    }}
                  />
                )}

                {activeTab === 'notifications' && (
                  <ProjectSettingsNotificationsTab
                    discordRouting={overrides.discordRouting}
                    discordWebhookUrlOverride={overrides.discordWebhookUrlOverride ?? ''}
                    telegramRouting={overrides.telegramRouting}
                    telegramChatIdOverride={overrides.telegramChatIdOverride ?? ''}
                    notifyGithubUser={notifyGithubUser}
                    onDiscordRoutingChange={(value) =>
                      setOverrides((current) => ({ ...current, discordRouting: value }))
                    }
                    onDiscordWebhookChange={(value) =>
                      setOverrides((current) => ({
                        ...current,
                        discordWebhookUrlOverride: value || null,
                      }))
                    }
                    onTelegramRoutingChange={(value) =>
                      setOverrides((current) => ({ ...current, telegramRouting: value }))
                    }
                    onTelegramChatIdChange={(value) =>
                      setOverrides((current) => ({
                        ...current,
                        telegramChatIdOverride: value || null,
                      }))
                    }
                    onNotifyGithubUserChange={setNotifyGithubUser}
                  />
                )}
              </div>
            </div>

            {displayError && (
              <div className="mx-8 mb-4 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
                <span className="line-clamp-1">{displayError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <ModalFooter className="shrink-0 border-t border-border px-6 py-4 mt-0">
        <Button variant="secondary" onClick={closeProjectSettingsModal} disabled={modalBusy}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void handleSave();
          }}
          disabled={modalBusy || !!nameError || (touched && !validation.ok)}
        >
          <LoadingButtonContent loading={saveMutation.isPending || setupSaveMutation.isPending}>
            <span>Save</span>
            <Keycap>⌘↩</Keycap>
          </LoadingButtonContent>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
