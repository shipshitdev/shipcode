import {
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
import { Button, Keycap, Modal, ModalFooter } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { Bell, Code2, FolderGit, Settings, Tags, Terminal, Workflow } from 'lucide-react';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { useAppSettings } from '../hooks/useAppSettings';
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
  buildRuntimeQaConfig,
  makeEnvFileId,
  textToCommands,
} from './project-settings-modal/setup-utils';
import {
  buildProjectDraft,
  type ContextGeneratorCli,
  type PhaseKey,
  PROJECT_TABS,
  type ProjectOverrideState,
  type ProjectTab,
} from './project-settings-modal/shared';
import {
  INITIAL_PROJECT_SETTINGS_UI_STATE,
  INITIAL_PROJECT_SETUP_FORM_STATE,
  type ProjectSettingsUiState,
  type ProjectSyncResult,
  projectSettingsUiReducer,
  projectSetupFormReducer,
} from './project-settings-modal/state';
import { TriageRulesTab } from './project-settings-modal/TriageRulesTab';
import { SettingsNavigation, type SettingsNavigationItem } from './SettingsNavigation';

function clearStoredWindowTimeout(ref: { current: number | null }) {
  const timeout = ref.current;
  if (timeout !== null) window.clearTimeout(timeout);
}

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
    key: 'triage',
    label: 'Triage rules',
    icon: <Tags size={14} />,
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

const SETUP_REDETECT_BUSY_MIN_MS = 400;

function useProjectSettingsModalView() {
  const queryClient = useQueryClient();
  const projectSettingsModalOpen = useAppStore((state) => state.projectSettingsModalOpen);
  const projectSettingsModalProjectId = useAppStore((state) => state.projectSettingsModalProjectId);
  const projectSettingsModalInitialTab = useAppStore(
    (state) => state.projectSettingsModalInitialTab,
  );
  const closeProjectSettingsModal = useAppStore((state) => state.closeProjectSettingsModal);

  const [settingsUi, dispatchSettingsUi] = useReducer(
    projectSettingsUiReducer,
    INITIAL_PROJECT_SETTINGS_UI_STATE,
  );
  const {
    activeTab,
    nameInput,
    urlInput,
    touched,
    submitError,
    overrides,
    contextGenerating,
    contextGeneratorCli,
    contextError,
    syncResult,
    syncError,
    relinkError,
    issueOverrideResetResult,
    issueOverrideResetError,
    modelValidation,
    notifyGithubUser,
    setupSaveError,
    manualSetupDetectPending,
  } = settingsUi;
  const [setupForm, dispatchSetupForm] = useReducer(
    projectSetupFormReducer,
    INITIAL_PROJECT_SETUP_FORM_STATE,
  );
  const {
    setupCommandsText,
    verifyCommandsText,
    testingContext,
    runtimeQaServerCommand,
    runtimeQaReadinessUrl,
    runtimeQaStartupTimeoutMs,
    runtimeQaPortEnvVar,
    runtimeQaTestCommandsText,
    runtimeQaDiscoverAgentTests,
    setupBeforeVerify,
    envFiles,
  } = setupForm;
  const patchSettingsUi = (patch: Partial<ProjectSettingsUiState>) =>
    dispatchSettingsUi({ type: 'patch', patch });
  const setActiveTab = (activeTab: ProjectTab) => patchSettingsUi({ activeTab });
  const setNameInput = (nameInput: string) => patchSettingsUi({ nameInput });
  const setUrlInput = (urlInput: string) => patchSettingsUi({ urlInput });
  const setTouched = (touched: boolean) => patchSettingsUi({ touched });
  const setSubmitError = (submitError: string | null) => patchSettingsUi({ submitError });
  const setSetupSaveError = (setupSaveError: string | null) => patchSettingsUi({ setupSaveError });
  const setSyncResult = (syncResult: ProjectSyncResult | null) => patchSettingsUi({ syncResult });
  const setSyncError = (syncError: string | null) => patchSettingsUi({ syncError });
  const setRelinkError = (relinkError: string | null) => patchSettingsUi({ relinkError });
  const setIssueOverrideResetResult = (issueOverrideResetResult: string | null) =>
    patchSettingsUi({ issueOverrideResetResult });
  const setIssueOverrideResetError = (issueOverrideResetError: string | null) =>
    patchSettingsUi({ issueOverrideResetError });
  const setContextGenerating = (contextGenerating: boolean) =>
    patchSettingsUi({ contextGenerating });
  const setContextGeneratorCli = (contextGeneratorCli: ContextGeneratorCli) =>
    patchSettingsUi({ contextGeneratorCli });
  const setContextError = (contextError: string | null) => patchSettingsUi({ contextError });
  const setNotifyGithubUser = (notifyGithubUser: string) => patchSettingsUi({ notifyGithubUser });
  const setOverrides: Dispatch<SetStateAction<ProjectOverrideState>> = (updater) =>
    dispatchSettingsUi({ type: 'overrides', updater });
  const setModelValidation: Dispatch<
    SetStateAction<Partial<Record<PhaseKey, OpenRouterModelValidation | null>>>
  > = (updater) => dispatchSettingsUi({ type: 'model-validation', updater });
  const setSetupCommandsText = (setupCommandsText: string) =>
    dispatchSetupForm({ type: 'patch', patch: { setupCommandsText } });
  const setVerifyCommandsText = (verifyCommandsText: string) =>
    dispatchSetupForm({ type: 'patch', patch: { verifyCommandsText } });
  const setTestingContext = (testingContext: string) =>
    dispatchSetupForm({ type: 'patch', patch: { testingContext } });
  const setRuntimeQaServerCommand = (runtimeQaServerCommand: string) =>
    dispatchSetupForm({ type: 'patch', patch: { runtimeQaServerCommand } });
  const setRuntimeQaReadinessUrl = (runtimeQaReadinessUrl: string) =>
    dispatchSetupForm({ type: 'patch', patch: { runtimeQaReadinessUrl } });
  const setRuntimeQaStartupTimeoutMs = (runtimeQaStartupTimeoutMs: number) =>
    dispatchSetupForm({ type: 'patch', patch: { runtimeQaStartupTimeoutMs } });
  const setRuntimeQaPortEnvVar = (runtimeQaPortEnvVar: string) =>
    dispatchSetupForm({ type: 'patch', patch: { runtimeQaPortEnvVar } });
  const setRuntimeQaTestCommandsText = (runtimeQaTestCommandsText: string) =>
    dispatchSetupForm({ type: 'patch', patch: { runtimeQaTestCommandsText } });
  const setRuntimeQaDiscoverAgentTests = (runtimeQaDiscoverAgentTests: boolean) =>
    dispatchSetupForm({ type: 'patch', patch: { runtimeQaDiscoverAgentTests } });
  const setSetupBeforeVerify = (setupBeforeVerify: boolean) =>
    dispatchSetupForm({ type: 'patch', patch: { setupBeforeVerify } });

  // Track open transition to apply initialTab only once
  const prevOpenRef = useRef(false);
  const setupDetectTimeoutRef = useRef<number | null>(null);

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get', { projectId: projectSettingsModalProjectId ?? '' }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: branches } = useQuery<string[]>({
    queryKey: ['git-branches', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke<string[]>('git:list-branches', {
        projectId: projectSettingsModalProjectId ?? '',
        fetch: false,
      }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: settings } = useAppSettings({ enabled: projectSettingsModalOpen });

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

  useEffect(() => {
    return () => {
      clearStoredWindowTimeout(setupDetectTimeoutRef);
    };
  }, []);

  // Seed all state on open transition
  useEffect(() => {
    const isOpening = projectSettingsModalOpen && !prevOpenRef.current;
    prevOpenRef.current = projectSettingsModalOpen;

    if (!projectSettingsModalOpen) return;

    const tab = projectSettingsModalInitialTab;
    const isValidTab = tab && (PROJECT_TABS as readonly string[]).includes(tab);
    dispatchSettingsUi({
      type: 'seed-open',
      activeTab: isOpening ? (isValidTab ? (tab as ProjectTab) : 'general') : null,
      project,
    });
  }, [projectSettingsModalOpen, projectSettingsModalInitialTab, project]);

  // Seed setup state from setup draft
  useEffect(() => {
    if (!projectSettingsModalOpen || !projectSetup) return;
    const contract = projectSetup.inspection.contract ?? projectSetup.suggestedContract;
    dispatchSetupForm({ type: 'contract', contract });
    dispatchSettingsUi({ type: 'patch', patch: { setupSaveError: null } });
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
      dispatchSetupForm({
        type: 'env-files',
        updater: (prev) => [
          ...prev,
          { id: makeEnvFileId(), source: '', target: undefined, required: true },
        ],
      }),
    [],
  );

  const updateEnvFile = useCallback(
    (id: string, patch: Partial<RepoSetupEnvFile>) =>
      dispatchSetupForm({
        type: 'env-files',
        updater: (prev) => prev.map((file) => (file.id === id ? { ...file, ...patch } : file)),
      }),
    [],
  );

  const removeEnvFile = useCallback(
    (id: string) =>
      dispatchSetupForm({
        type: 'env-files',
        updater: (prev) => prev.filter((file) => file.id !== id),
      }),
    [],
  );

  const applySetupContract = useCallback((contract: RepoSetupContract) => {
    dispatchSetupForm({ type: 'contract', contract });
    dispatchSettingsUi({ type: 'patch', patch: { setupSaveError: null } });
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) return null;
      const [, , , , updatedProject] = await Promise.all([
        window.shipcode.invoke<Project>('project:set-name', {
          projectId: projectSettingsModalProjectId,
          name: normalizedName,
        }),
        window.shipcode.invoke<Project>('project:set-github-project-url', {
          projectId: projectSettingsModalProjectId,
          url: validation.ok ? validation.value : null,
        }),
        window.shipcode.invoke<Project>('project:set-notification-routing', {
          projectId: projectSettingsModalProjectId,
          routing: {
            discordRouting: overrides.discordRouting,
            discordWebhookUrlOverride: overrides.discordWebhookUrlOverride,
            telegramRouting: overrides.telegramRouting,
            telegramChatIdOverride: overrides.telegramChatIdOverride,
          },
        }),
        window.shipcode.invoke<Project>('project:set-notify-github-user', {
          projectId: projectSettingsModalProjectId,
          handle: notifyGithubUser.trim() || null,
        }),
        window.shipcode.invoke<Project>('project:set-model-overrides', {
          projectId: projectSettingsModalProjectId,
          overrides,
        }),
      ]);
      return updatedProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
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
        envFiles: envFiles.flatMap((file) => {
          const source = file.source.trim();
          return source
            ? [
                {
                  source,
                  target: file.target?.trim() || undefined,
                  required: file.required,
                },
              ]
            : [];
        }),
        setupBeforeVerify,
        testingContext: testingContext.trim() || null,
        runtimeQa: buildRuntimeQaConfig({
          serverCommand: runtimeQaServerCommand,
          readinessUrl: runtimeQaReadinessUrl,
          startupTimeoutMs: runtimeQaStartupTimeoutMs,
          portEnvVar: runtimeQaPortEnvVar,
          testCommandsText: runtimeQaTestCommandsText,
          discoverAgentTests: runtimeQaDiscoverAgentTests,
        }),
      };
      return window.shipcode.invoke('project:save-setup', {
        projectId: projectSettingsModalProjectId,
        contract,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-setup', projectSettingsModalProjectId] });
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
      queryClient.invalidateQueries({ queryKey: ['github-issues', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] sync failed', err);
      setSyncResult(null);
      setSyncError(clampError(err));
    },
  });

  const setDefaultBranchMutation = useMutation({
    mutationFn: async (branch: string) => {
      if (!projectSettingsModalProjectId) throw new Error('No project selected');
      return window.shipcode.invoke<Project>('project:set-default-branch', {
        projectId: projectSettingsModalProjectId,
        branch,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({
        queryKey: ['thread-panel-data', projectSettingsModalProjectId],
      });
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] set default branch failed', err);
      setSubmitError(clampError(err));
    },
  });

  const refreshBranchesMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) throw new Error('No project selected');
      return window.shipcode.invoke<string[]>('git:list-branches', {
        projectId: projectSettingsModalProjectId,
        fetch: true,
      });
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(['git-branches', projectSettingsModalProjectId], fresh);
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] refresh branches failed', err);
    },
  });

  const refreshGitRemoteMutation = useMutation({
    mutationFn: async () => {
      if (!projectSettingsModalProjectId) throw new Error('No project selected');
      return window.shipcode.invoke<{ project: Project; remote: string | null; changed: boolean }>(
        'project:refresh-git-remote',
        { projectId: projectSettingsModalProjectId },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectSettingsModalProjectId] });
      queryClient.invalidateQueries({
        queryKey: ['thread-panel-data', projectSettingsModalProjectId],
      });
    },
    onError: (err: unknown) => {
      log.error('[ProjectSettingsModal] refresh git remote failed', err);
      setSubmitError(clampError(err));
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
      queryClient.invalidateQueries({ queryKey: ['project-setup', projectSettingsModalProjectId] });
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

  const handleSetupRedetect = useCallback(() => {
    if (manualSetupDetectPending) return;
    dispatchSettingsUi({ type: 'patch', patch: { manualSetupDetectPending: true } });
    const startedAt = Date.now();

    void refetchSetup().finally(() => {
      const remainingMs = Math.max(SETUP_REDETECT_BUSY_MIN_MS - (Date.now() - startedAt), 0);
      if (setupDetectTimeoutRef.current !== null) {
        window.clearTimeout(setupDetectTimeoutRef.current);
      }
      setupDetectTimeoutRef.current = window.setTimeout(() => {
        setupDetectTimeoutRef.current = null;
        dispatchSettingsUi({ type: 'patch', patch: { manualSetupDetectPending: false } });
      }, remainingMs);
    });
  }, [manualSetupDetectPending, refetchSetup]);

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
        <div className="px-6 py-4 text-xs text-muted-foreground">Loading project…</div>
      ) : (
        <div className="flex min-h-0 flex-1" data-testid="project-settings-modal">
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
                    branches={branches ?? []}
                    onSetDefaultBranch={(branch) => setDefaultBranchMutation.mutate(branch)}
                    setDefaultBranchPending={setDefaultBranchMutation.isPending}
                    onRefreshBranches={() => refreshBranchesMutation.mutate()}
                    refreshBranchesPending={refreshBranchesMutation.isPending}
                    onRefreshGitRemote={() => refreshGitRemoteMutation.mutate()}
                    refreshGitRemotePending={refreshGitRemoteMutation.isPending}
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
                    runtimeQaServerCommand={runtimeQaServerCommand}
                    setRuntimeQaServerCommand={setRuntimeQaServerCommand}
                    runtimeQaReadinessUrl={runtimeQaReadinessUrl}
                    setRuntimeQaReadinessUrl={setRuntimeQaReadinessUrl}
                    runtimeQaStartupTimeoutMs={runtimeQaStartupTimeoutMs}
                    setRuntimeQaStartupTimeoutMs={setRuntimeQaStartupTimeoutMs}
                    runtimeQaPortEnvVar={runtimeQaPortEnvVar}
                    setRuntimeQaPortEnvVar={setRuntimeQaPortEnvVar}
                    runtimeQaTestCommandsText={runtimeQaTestCommandsText}
                    setRuntimeQaTestCommandsText={setRuntimeQaTestCommandsText}
                    runtimeQaDiscoverAgentTests={runtimeQaDiscoverAgentTests}
                    setRuntimeQaDiscoverAgentTests={setRuntimeQaDiscoverAgentTests}
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
                    onRedetect={handleSetupRedetect}
                    onApplyDetectedProfile={(profile) => {
                      applySetupContract(profile.suggestedContract);
                    }}
                    detectPending={setupDetectPending || manualSetupDetectPending}
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
                    statusMapping={project?.githubStatusMapping ?? null}
                    hasProjectUrl={!!project?.githubProjectUrl}
                  />
                )}

                {activeTab === 'triage' && (
                  <TriageRulesTab
                    projectId={projectSettingsModalProjectId ?? ''}
                    isActive={activeTab === 'triage'}
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
          data-testid="project-settings-save-btn"
          onClick={() => {
            void handleSave();
          }}
          disabled={modalBusy || !!nameError || (touched && !validation.ok)}
        >
          <LoadingButtonContent loading={saveMutation.isPending || setupSaveMutation.isPending}>
            <span>Save</span>
            <Keycap className="border-transparent bg-black/10 text-current shadow-none">⌘⏎</Keycap>
          </LoadingButtonContent>
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function ProjectSettingsModal() {
  return useProjectSettingsModalView();
}
