import {
  type AppSettings,
  type ContextFileInfo,
  clampError,
  type IntegrationStatus,
  type OpenRouterModelValidation,
  type Project,
  type ProjectSetupDraft,
  validateGithubProjectUrl,
} from '@shipcode/shared';
import {
  Button,
  Keycap,
  Modal,
  ModalFooter,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@shipcode/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useEffect, useMemo, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { ProjectSettingsContextTab } from './project-settings-modal/ProjectSettingsContextTab';
import { ProjectSettingsGeneralTab } from './project-settings-modal/ProjectSettingsGeneralTab';
import { ProjectSettingsModelsTab } from './project-settings-modal/ProjectSettingsModelsTab';
import {
  buildProjectDraft,
  type ContextGeneratorCli,
  EMPTY_OVERRIDES,
  type PhaseKey,
  type ProjectOverrideState,
  type ProjectTab,
} from './project-settings-modal/shared';

export function ProjectSettingsModal() {
  const queryClient = useQueryClient();
  const {
    projectSettingsModalOpen,
    projectSettingsModalProjectId,
    closeProjectSettingsModal,
    openProjectSetupModal,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<ProjectTab>('general');
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
  const [modelValidation, setModelValidation] = useState<
    Partial<Record<PhaseKey, OpenRouterModelValidation | null>>
  >({});

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

  const { data: projectSetup } = useQuery<ProjectSetupDraft>({
    queryKey: ['project-setup', projectSettingsModalProjectId],
    queryFn: () =>
      window.shipcode.invoke('project:get-setup', {
        projectId: projectSettingsModalProjectId ?? '',
      }),
    enabled: !!projectSettingsModalProjectId && projectSettingsModalOpen,
    staleTime: 0,
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
      discordRouting: project?.discordRouting ?? 'inherit',
      discordWebhookUrlOverride: project?.discordWebhookUrlOverride ?? null,
      telegramRouting: project?.telegramRouting ?? 'inherit',
      telegramChatIdOverride: project?.telegramChatIdOverride ?? null,
    });
    setTouched(false);
    setSubmitError(null);
    setSyncResult(null);
    setSyncError(null);
    setContextGenerating(false);
    setContextGeneratorCli('claude');
    setContextError(null);
    setRelinkError(null);
    setModelValidation({});
  }, [
    projectSettingsModalOpen,
    project?.executorModelIdOverride,
    project?.executorModelOverride,
    project?.executorReasoningEffortOverride,
    project?.discordRouting,
    project?.discordWebhookUrlOverride,
    project?.githubProjectUrl,
    project?.plannerModelIdOverride,
    project?.plannerModelOverride,
    project?.plannerReasoningEffortOverride,
    project?.reviewerModelIdOverride,
    project?.reviewerModelOverride,
    project?.reviewerReasoningEffortOverride,
    project?.verifierModelIdOverride,
    project?.verifierModelOverride,
    project?.verifierReasoningEffortOverride,
    project?.telegramRouting,
    project?.telegramChatIdOverride,
  ]);

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
      await window.shipcode.invoke<Project>('project:set-notification-routing', {
        projectId: projectSettingsModalProjectId,
        routing: {
          discordRouting: overrides.discordRouting,
          discordWebhookUrlOverride: overrides.discordWebhookUrlOverride,
          telegramRouting: overrides.telegramRouting,
          telegramChatIdOverride: overrides.telegramChatIdOverride,
        },
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

  const { data: contextFiles, refetch: refetchContext } = useQuery<ContextFileInfo[]>({
    queryKey: ['context-files', projectSettingsModalProjectId],
    queryFn: () => {
      if (!projectSettingsModalProjectId) {
        throw new Error('Missing project id for context files');
      }
      return window.shipcode.invoke<ContextFileInfo[]>('context:list', {
        projectId: projectSettingsModalProjectId,
      });
    },
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
  const canSync =
    hasSavedUrl && inputMatchesSaved && !syncMutation.isPending && !saveMutation.isPending;
  const modalBusy = saveMutation.isPending || contextGenerating;
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
      handleSave();
    }
  };

  return (
    <Modal
      open={projectSettingsModalOpen}
      onClose={() => {
        if (!modalBusy) closeProjectSettingsModal();
      }}
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
              <ProjectSettingsGeneralTab
                project={project}
                urlInput={urlInput}
                setUrlInput={setUrlInput}
                setTouched={setTouched}
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
                syncPending={syncMutation.isPending}
                syncResult={syncResult}
                syncError={syncError}
                hasSavedUrl={hasSavedUrl}
                inputMatchesSaved={inputMatchesSaved}
                onSync={handleSync}
                setupInspection={projectSetup?.inspection ?? null}
                discordRouting={overrides.discordRouting}
                discordWebhookUrlOverride={overrides.discordWebhookUrlOverride ?? ''}
                telegramRouting={overrides.telegramRouting}
                telegramChatIdOverride={overrides.telegramChatIdOverride ?? ''}
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
                onConfigureSetup={() => {
                  closeProjectSettingsModal();
                  openProjectSetupModal(project.id);
                }}
              />
            </TabsContent>

            <TabsContent value="models" className="space-y-3">
              <ProjectSettingsModelsTab
                settings={settings}
                projectDraft={projectDraft}
                overrides={overrides}
                setOverrides={setOverrides}
                integrationStatus={integrationStatus}
                modelValidation={modelValidation}
                setModelValidation={setModelValidation}
              />
            </TabsContent>

            <TabsContent value="context" className="space-y-4">
              <ProjectSettingsContextTab
                contextFiles={contextFiles}
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
        <Button variant="secondary" onClick={closeProjectSettingsModal} disabled={modalBusy}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={modalBusy || (touched && !validation.ok)}>
          <span>{saveMutation.isPending ? 'Saving…' : 'Save'}</span>
          <Keycap>⌘↩</Keycap>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
