import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  StatusMappingEditor,
  Button,
  Input,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@shipcode/ui';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type GitHubIssueCacheRecord,
  type IntegrationStatus,
  type OpenRouterModelCheck,
  type Project,
} from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';
import { SHORTCUTS, type ShortcutCategory, type ShortcutDef } from '../data/shortcuts';

type ExecutorModel = 'claude' | 'codex' | 'openrouter';

function StatusPill({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : tone === 'danger'
          ? 'border-red-500/30 bg-red-500/10 text-red-300'
          : 'border-border bg-tertiary text-secondary';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}>
      {children}
    </span>
  );
}

function PhaseModelRow({
  label,
  htmlFor,
  modelValue,
  openrouterModelValue,
  reasoningEffortValue,
  validProviders,
  onModelChange,
  onOpenrouterModelChange,
  onReasoningEffortChange,
  disabledProviders,
  warningMessage,
  modelCheck,
}: {
  label: string;
  htmlFor: string;
  modelValue: string;
  openrouterModelValue: string | null;
  reasoningEffortValue: 'low' | 'medium' | 'high';
  validProviders: ExecutorModel[];
  onModelChange: (v: string) => void;
  onOpenrouterModelChange: (v: string | null) => void;
  onReasoningEffortChange: (v: 'low' | 'medium' | 'high') => void;
  disabledProviders?: Partial<Record<ExecutorModel, string>>;
  warningMessage?: string | null;
  modelCheck?: OpenRouterModelCheck | null;
}) {
  const modelCheckMessage =
    modelValue === 'openrouter' && modelCheck?.status !== 'not_configured'
      ? modelCheck?.message
      : null;

  return (
    <>
      <SettingsRow label={label} htmlFor={htmlFor}>
        <Select value={modelValue} onValueChange={onModelChange}>
          <SelectTrigger id={htmlFor} className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {validProviders.includes('claude') && (
              <SelectItem value="claude" disabled={!!disabledProviders?.claude}>
                Anthropic{disabledProviders?.claude ? ` (${disabledProviders.claude})` : ''}
              </SelectItem>
            )}
            {validProviders.includes('codex') && (
              <SelectItem value="codex" disabled={!!disabledProviders?.codex}>
                OpenAI{disabledProviders?.codex ? ` (${disabledProviders.codex})` : ''}
              </SelectItem>
            )}
            {validProviders.includes('openrouter') && (
              <SelectItem value="openrouter" disabled={!!disabledProviders?.openrouter}>
                OpenRouter{disabledProviders?.openrouter ? ` (${disabledProviders.openrouter})` : ''}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>
      {modelValue === 'openrouter' && (
        <SettingsRow
          label="OpenRouter model ID"
          htmlFor={`${htmlFor}-or-model`}
          description="Leave blank to use the default paid model."
        >
          <Input
            id={`${htmlFor}-or-model`}
            placeholder="e.g. anthropic/claude-sonnet-4-6"
            defaultValue={openrouterModelValue ?? ''}
            onBlur={(e) => {
              const val = e.target.value.trim() || null;
              onOpenrouterModelChange(val);
            }}
          />
        </SettingsRow>
      )}
      <SettingsRow label="Reasoning effort" htmlFor={`${htmlFor}-reasoning`}>
        <Select
          value={reasoningEffortValue}
          onValueChange={(v) => onReasoningEffortChange(v as 'low' | 'medium' | 'high')}
        >
          <SelectTrigger id={`${htmlFor}-reasoning`} className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">low</SelectItem>
            <SelectItem value="medium">medium</SelectItem>
            <SelectItem value="high">high</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      {warningMessage && (
        <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {warningMessage}
        </div>
      )}
      {modelCheckMessage && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-[11px] ${
            modelCheck?.status === 'invalid'
              ? 'border-red-500/20 bg-red-500/10 text-red-300'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
          }`}
        >
          {modelCheckMessage}
        </div>
      )}
    </>
  );
}

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const { settingsSection } = useAppStore();
  const [worktreeRootError, setWorktreeRootError] = useState<string | null>(null);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
  });

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.shipcode.invoke('settings:set', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const { data: archivedProjects = [] } = useQuery<Project[]>({
    queryKey: ['projects-archived'],
    queryFn: () => window.shipcode.invoke<Project[]>('project:list-archived'),
    enabled: settingsSection === 'archived',
  });

  const unarchiveProject = useMutation({
    mutationFn: (projectId: string) => window.shipcode.invoke('project:unarchive', { projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
    },
  });

  const { data: archivedIssues = [] } = useQuery<GitHubIssueCacheRecord[]>({
    queryKey: ['issues-archived'],
    queryFn: () => window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-archived'),
    enabled: settingsSection === 'archived',
  });

  const unarchiveIssue = useMutation({
    mutationFn: (issueId: string) =>
      window.shipcode.invoke('github:unarchive-issue', { issueId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues-archived'] });
      queryClient.invalidateQueries({ queryKey: ['github-issues'] });
    },
  });

  const {
    data: integrationStatus,
    refetch: refetchIntegrations,
    isFetching: integrationsFetching,
  } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    enabled: settingsSection === 'integrations' || settingsSection === 'pipeline',
    staleTime: 30_000,
  });

  if (!settings) return null;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl">
        {settingsSection === 'general' && (
          <>
            <h3 className="mb-5">General</h3>

            <section className="mb-8">
              <h4 className="mb-3 text-secondary">Worktree Location</h4>
              <SettingsRow label="Worktree root" htmlFor="worktree-root">
                <Input
                  id="worktree-root"
                  type="text"
                  placeholder="~/.shipcode/worktrees"
                  className="w-[280px]"
                  defaultValue={settings.worktreeRoot ?? ''}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw === '' ? null : raw;
                    setWorktreeRootError(null);
                    updateSettings.mutate(
                      { worktreeRoot: next },
                      {
                        onError: (err: unknown) => {
                          setWorktreeRootError(err instanceof Error ? err.message : String(err));
                        },
                      },
                    );
                  }}
                />
              </SettingsRow>
              <p className="text-xs text-secondary mt-2">
                Default: <code>~/.shipcode/worktrees</code>. Use an absolute path or{' '}
                <code>~/…</code> to customize, or leave blank to reset to default. Relative paths
                are rejected.
              </p>
              {worktreeRootError ? (
                <p className="text-xs text-red-500 mt-1">{worktreeRootError}</p>
              ) : null}
              <SettingsRow label="Branch format" htmlFor="worktree-branch-format">
                <Input
                  id="worktree-branch-format"
                  type="text"
                  placeholder={DEFAULT_SETTINGS.worktreeBranchFormat}
                  className="w-[280px]"
                  defaultValue={settings.worktreeBranchFormat ?? DEFAULT_SETTINGS.worktreeBranchFormat}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw === '' ? DEFAULT_SETTINGS.worktreeBranchFormat : raw;
                    updateSettings.mutate({ worktreeBranchFormat: next });
                  }}
                />
              </SettingsRow>
              <p className="text-xs text-secondary mt-2">
                Tokens: <code>{'{id}'}</code> = issue number, <code>{'{slug}'}</code> = slugified
                title. Default: <code>{DEFAULT_SETTINGS.worktreeBranchFormat}</code>. Leave blank to reset.
              </p>
            </section>

            <section className="mb-8">
              <h4 className="mb-3 text-secondary">Setup</h4>
              <SettingsRow label="Re-run the onboarding wizard">
                <Button
                  variant="secondary"
                  onClick={() => updateSettings.mutate({ onboardingVersion: 0 })}
                >
                  Re-run Setup
                </Button>
              </SettingsRow>
            </section>
          </>
        )}

        {settingsSection === 'integrations' && (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3>Integrations</h3>
                <p className="mt-1 text-xs text-secondary">
                  CLI and provider readiness. API keys remain env-managed for now.
                </p>
              </div>
              <Button variant="secondary" onClick={() => refetchIntegrations()} disabled={integrationsFetching}>
                {integrationsFetching ? 'Checking…' : 'Re-check'}
              </Button>
            </div>

            {!integrationStatus ? (
              <div className="text-[13px] text-muted">Loading integration status…</div>
            ) : (
              <>
                <section className="mb-8">
                  <h4 className="mb-3 text-secondary">CLI Integrations</h4>
                  <div className="space-y-2">
                    {[
                      { key: 'claude', label: 'Claude CLI' },
                      { key: 'codex', label: 'Codex CLI' },
                      { key: 'gh', label: 'GitHub CLI' },
                    ].map(({ key, label }) => {
                      const cli =
                        key === 'claude'
                          ? integrationStatus.system.claude
                          : key === 'codex'
                            ? integrationStatus.system.codex
                            : integrationStatus.system.gh;
                      const ghScope =
                        key === 'gh'
                          ? integrationStatus.ghAuth.hasProjectScope === true
                            ? 'project scope granted'
                            : integrationStatus.ghAuth.hasProjectScope === false
                              ? 'project scope missing'
                              : null
                          : null;

                      return (
                        <div
                          key={key}
                          className="rounded-md border border-border bg-secondary/40 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="min-w-[110px] text-[13px] font-medium text-primary">
                              {label}
                            </div>
                            {!cli.available ? (
                              <StatusPill tone="danger">Not installed</StatusPill>
                            ) : key === 'gh' ? (
                              integrationStatus.ghAuth.authenticated ? (
                                <StatusPill tone="success">Authenticated</StatusPill>
                              ) : (
                                <StatusPill tone="warning">Not authenticated</StatusPill>
                              )
                            ) : cli.authenticated ? (
                              <StatusPill tone="success">Authenticated</StatusPill>
                            ) : (
                              <StatusPill tone="warning">Not authenticated</StatusPill>
                            )}
                            {ghScope && (
                              <StatusPill tone={integrationStatus.ghAuth.hasProjectScope ? 'success' : 'warning'}>
                                {ghScope}
                              </StatusPill>
                            )}
                          </div>
                          <div className="mt-2 space-y-1 text-[12px] text-secondary">
                            {cli.version ? <div>Version: <code>{cli.version}</code></div> : null}
                            {cli.path ? <div>Path: <code>{cli.path}</code></div> : null}
                            {key === 'gh' && integrationStatus.ghAuth.username ? (
                              <div>Account: <code>@{integrationStatus.ghAuth.username}</code></div>
                            ) : null}
                            {cli.error ? <div className="text-red-300">{cli.error}</div> : null}
                            {key === 'gh' && integrationStatus.ghAuth.hasProjectScope === false ? (
                              <div className="text-amber-300">
                                Run <code>gh auth refresh -s project</code> to attach issues to project boards.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="mb-8">
                  <h4 className="mb-3 text-secondary">API Keys</h4>
                  <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] text-secondary">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-primary">OpenRouter</span>
                      <StatusPill tone={integrationStatus.openrouter.enabled ? 'neutral' : 'warning'}>
                        {integrationStatus.openrouter.enabled ? 'Enabled in settings' : 'Disabled in settings'}
                      </StatusPill>
                      <StatusPill tone={integrationStatus.openrouter.keyPresent ? 'success' : 'warning'}>
                        {integrationStatus.openrouter.keyPresent ? 'OPENROUTER_API_KEY detected' : 'OPENROUTER_API_KEY missing'}
                      </StatusPill>
                      <StatusPill
                        tone={
                          integrationStatus.openrouter.authStatus === 'valid'
                            ? 'success'
                            : integrationStatus.openrouter.authStatus === 'disabled'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {integrationStatus.openrouter.authStatus}
                      </StatusPill>
                    </div>
                    <div className="space-y-1">
                      <div>
                        ShipCode currently reads <code>OPENROUTER_API_KEY</code> from the environment exposed to the desktop app.
                      </div>
                      {integrationStatus.openrouter.label ? (
                        <div>Key label: <code>{integrationStatus.openrouter.label}</code></div>
                      ) : null}
                      {integrationStatus.openrouter.message ? (
                        <div className="text-amber-300">{integrationStatus.openrouter.message}</div>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="mb-8">
                  <h4 className="mb-3 text-secondary">OpenRouter Models</h4>
                  <div className="space-y-2">
                    {integrationStatus.openrouter.modelChecks.map((check) => (
                      <div
                        key={check.key}
                        className="rounded-md border border-border bg-secondary/40 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-[140px] text-[13px] font-medium text-primary">
                            {check.label}
                          </div>
                          <StatusPill
                            tone={
                              check.status === 'valid'
                                ? 'success'
                                : check.status === 'invalid'
                                  ? 'danger'
                                  : check.status === 'unverified'
                                    ? 'warning'
                                    : 'neutral'
                            }
                          >
                            {check.status}
                          </StatusPill>
                        </div>
                        <div className="mt-2 space-y-1 text-[12px] text-secondary">
                          <div>
                            Model: <code>{check.modelId ?? '(not configured)'}</code>
                          </div>
                          {check.message ? <div className="text-amber-300">{check.message}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {settingsSection === 'github' && (
          <>
            <h3 className="mb-5">GitHub</h3>

            <section className="mb-8">
              <h4 className="mb-3 text-secondary">GitHub Integration</h4>
              <SettingsRow label="Polling enabled" htmlFor="polling-enabled">
                <Switch
                  id="polling-enabled"
                  checked={settings.githubPollingEnabled}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ githubPollingEnabled: !!checked })
                  }
                />
              </SettingsRow>
              <SettingsRow label="Poll interval (ms)" htmlFor="poll-interval">
                <Input
                  id="poll-interval"
                  type="number"
                  className="w-[120px]"
                  value={settings.githubPollingIntervalMs}
                  onChange={(e) =>
                    updateSettings.mutate({ githubPollingIntervalMs: parseInt(e.target.value, 10) })
                  }
                  min={5000}
                  step={5000}
                />
              </SettingsRow>
              <SettingsRow label="Auto-pickup issues" htmlFor="auto-pickup">
                <Switch
                  id="auto-pickup"
                  checked={settings.autoPickupEnabled}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ autoPickupEnabled: !!checked })
                  }
                />
              </SettingsRow>
            </section>
          </>
        )}

        {settingsSection === 'notifications' && (
          <>
            <h3 className="mb-5">Notifications</h3>

            <section className="mb-8">
              <SettingsRow label="Enable notifications" htmlFor="notifications-enabled">
                <Switch
                  id="notifications-enabled"
                  checked={settings.notificationsEnabled}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ notificationsEnabled: !!checked })
                  }
                />
              </SettingsRow>
              <SettingsRow label="OS notifications" htmlFor="notification-os">
                <Switch
                  id="notification-os"
                  checked={settings.notificationOsEnabled}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ notificationOsEnabled: !!checked })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
              <SettingsRow label="Dock badge count" htmlFor="notification-badge">
                <Switch
                  id="notification-badge"
                  checked={settings.notificationBadgeEnabled}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ notificationBadgeEnabled: !!checked })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
              <SettingsRow label="Play sound" htmlFor="notification-sound">
                <Switch
                  id="notification-sound"
                  checked={settings.notificationSoundEnabled}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ notificationSoundEnabled: !!checked })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>

              <p className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted">Notify me when</p>

              <SettingsRow label="Awaiting approval" htmlFor="notify-awaiting-approval">
                <Switch
                  id="notify-awaiting-approval"
                  checked={settings.notificationEvents.awaitingApproval}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({
                      notificationEvents: {
                        ...settings.notificationEvents,
                        awaitingApproval: !!checked,
                      },
                    })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
              <SettingsRow label="Pipeline failed" htmlFor="notify-failed">
                <Switch
                  id="notify-failed"
                  checked={settings.notificationEvents.failed}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({
                      notificationEvents: { ...settings.notificationEvents, failed: !!checked },
                    })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
              <SettingsRow label="CI blocked" htmlFor="notify-ci-blocked">
                <Switch
                  id="notify-ci-blocked"
                  checked={settings.notificationEvents.ciBlocked}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({
                      notificationEvents: {
                        ...settings.notificationEvents,
                        ciBlocked: !!checked,
                      },
                    })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
              <SettingsRow label="Pipeline completed" htmlFor="notify-completed">
                <Switch
                  id="notify-completed"
                  checked={settings.notificationEvents.completed}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({
                      notificationEvents: { ...settings.notificationEvents, completed: !!checked },
                    })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
              <SettingsRow
                label="Verification retries exhausted"
                htmlFor="notify-verification-exhausted"
              >
                <Switch
                  id="notify-verification-exhausted"
                  checked={settings.notificationEvents.verificationExhausted}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({
                      notificationEvents: {
                        ...settings.notificationEvents,
                        verificationExhausted: !!checked,
                      },
                    })
                  }
                  disabled={!settings.notificationsEnabled}
                />
              </SettingsRow>
            </section>
          </>
        )}

        {settingsSection === 'pipeline' && (
          <>
            <h3 className="mb-5">Pipeline</h3>

            <section className="mb-8">
              <SettingsRow
                label="Require approval before execution"
                htmlFor="require-approval"
                description="When on, pipeline pauses after review for your sign-off. When off, it executes automatically."
              >
                <Switch
                  id="require-approval"
                  checked={settings.requireApproval}
                  onCheckedChange={(checked: boolean) =>
                    updateSettings.mutate({ requireApproval: checked })
                  }
                />
              </SettingsRow>
              <SettingsRow
                label="Max concurrent pipelines"
                htmlFor="max-concurrent-pipelines"
                description="How many pipelines can run at once. Extras are queued."
              >
                <Input
                  id="max-concurrent-pipelines"
                  type="number"
                  className="w-[80px]"
                  value={settings.maxConcurrentPipelines}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= 10) updateSettings.mutate({ maxConcurrentPipelines: val });
                  }}
                  min={1}
                  max={10}
                  step={1}
                />
              </SettingsRow>
              <SettingsRow
                label="Review rounds"
                htmlFor="max-review-rounds"
                description="How many review→revise cycles before execution or approval."
              >
                <Input
                  id="max-review-rounds"
                  type="number"
                  className="w-[80px]"
                  value={settings.maxReviewRounds}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= 5) updateSettings.mutate({ maxReviewRounds: val });
                  }}
                  min={1}
                  max={5}
                  step={1}
                />
              </SettingsRow>
              <SettingsRow
                label="Planner max turns"
                htmlFor="planner-max-turns"
                description="Max Claude turns per plan / revision / verify phase."
              >
                <Input
                  id="planner-max-turns"
                  type="number"
                  className="w-[80px]"
                  value={settings.plannerMaxTurns}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= 20) updateSettings.mutate({ plannerMaxTurns: val });
                  }}
                  min={1}
                  max={20}
                  step={1}
                />
              </SettingsRow>
              <PhaseModelRow
                label="Planner model"
                htmlFor="planner-model"
                modelValue={settings.plannerModel}
                openrouterModelValue={settings.openrouterPlannerModel}
                reasoningEffortValue={settings.plannerReasoningEffort}
                validProviders={['claude', 'codex', 'openrouter']}
                onModelChange={(v) => updateSettings.mutate({ plannerModel: v as AppSettings['plannerModel'] })}
                onOpenrouterModelChange={(v) => updateSettings.mutate({ openrouterPlannerModel: v })}
                onReasoningEffortChange={(v) => updateSettings.mutate({ plannerReasoningEffort: v })}
                modelCheck={
                  integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'planner') ?? null
                }
                warningMessage={
                  settings.plannerModel === 'openrouter' &&
                  integrationStatus?.openrouter.authStatus !== 'valid'
                    ? integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'
                    : null
                }
              />
              <PhaseModelRow
                label="Reviewer model"
                htmlFor="reviewer-model"
                modelValue={settings.reviewerModel}
                openrouterModelValue={settings.openrouterReviewerModel}
                reasoningEffortValue={settings.reviewerReasoningEffort}
                validProviders={['claude', 'codex', 'openrouter']}
                onModelChange={(v) => updateSettings.mutate({ reviewerModel: v as AppSettings['reviewerModel'] })}
                onOpenrouterModelChange={(v) => updateSettings.mutate({ openrouterReviewerModel: v })}
                onReasoningEffortChange={(v) => updateSettings.mutate({ reviewerReasoningEffort: v })}
                modelCheck={
                  integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'reviewer') ?? null
                }
                warningMessage={
                  settings.reviewerModel === 'openrouter' &&
                  integrationStatus?.openrouter.authStatus !== 'valid'
                    ? integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'
                    : null
                }
              />
              <PhaseModelRow
                label="Executor model"
                htmlFor="executor-model"
                modelValue={settings.executorModel}
                openrouterModelValue={settings.openrouterExecutorModel}
                reasoningEffortValue={settings.executorReasoningEffort}
                validProviders={['claude', 'codex', 'openrouter']}
                onModelChange={(v) => updateSettings.mutate({ executorModel: v as AppSettings['executorModel'] })}
                onOpenrouterModelChange={(v) => updateSettings.mutate({ openrouterExecutorModel: v })}
                onReasoningEffortChange={(v) => updateSettings.mutate({ executorReasoningEffort: v })}
                disabledProviders={{ openrouter: 'execute unsupported' }}
                modelCheck={
                  integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'executor') ?? null
                }
                warningMessage={
                  settings.executorModel === 'openrouter'
                    ? 'OpenRouter execute is not supported yet.'
                    : null
                }
              />
              <PhaseModelRow
                label="Verifier model"
                htmlFor="verifier-model"
                modelValue={settings.verifierModel}
                openrouterModelValue={settings.openrouterVerifierModel}
                reasoningEffortValue={settings.verifierReasoningEffort}
                validProviders={['claude', 'codex', 'openrouter']}
                onModelChange={(v) => updateSettings.mutate({ verifierModel: v as AppSettings['verifierModel'] })}
                onOpenrouterModelChange={(v) => updateSettings.mutate({ openrouterVerifierModel: v })}
                onReasoningEffortChange={(v) => updateSettings.mutate({ verifierReasoningEffort: v })}
                modelCheck={
                  integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'verifier') ?? null
                }
                warningMessage={
                  settings.verifierModel === 'openrouter' &&
                  integrationStatus?.openrouter.authStatus !== 'valid'
                    ? integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'
                    : null
                }
              />
              <SettingsRow
                label="Test command"
                description="Shell command run after execution in the worktree. Leave blank to skip."
              >
                <Input
                  placeholder="e.g. bun run test"
                  defaultValue={settings.testCommand ?? ''}
                  onBlur={(e) => {
                    const val = e.target.value.trim() || null;
                    updateSettings.mutate({ testCommand: val });
                  }}
                />
              </SettingsRow>
              <SettingsRow
                label="Testing context"
                description="Describe the project's test conventions (framework, file location, mock patterns). Injected into the executor."
              >
                <Textarea
                  placeholder="e.g. Tests use Vitest, colocated as *.test.ts, use vi.mock() for mocking."
                  defaultValue={settings.testingContext ?? ''}
                  onBlur={(e) => {
                    const val = e.target.value.trim() || null;
                    updateSettings.mutate({ testingContext: val });
                  }}
                />
              </SettingsRow>
            </section>

            <section className="mb-8">
              <StatusMappingEditor
                mappings={settings.statusLabelMappings}
                onSave={(mappings) => updateSettings.mutate({ statusLabelMappings: mappings })}
              />
            </section>
          </>
        )}

        {settingsSection === 'shortcuts' && <ShortcutsSection />}

        {settingsSection === 'archived' && (
          <>
            <h3 className="mb-5">Archived</h3>
            <Tabs defaultValue="projects">
              <TabsList className="mb-5">
                <TabsTrigger value="projects">Projects</TabsTrigger>
                <TabsTrigger value="issues">Issues</TabsTrigger>
              </TabsList>

              <TabsContent value="projects">
                <section className="mb-8">
                  <p className="mb-3 text-xs text-secondary">
                    Archived projects are hidden from the sidebar but remain navigable via Activity
                    and notifications. They re-appear automatically when new work arrives, or you
                    can restore one manually here.
                  </p>
                  {archivedProjects.length === 0 ? (
                    <p className="text-[13px] text-muted">No archived projects.</p>
                  ) : (
                    <div className="space-y-1">
                      {archivedProjects.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-md border border-border bg-tertiary px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] text-primary truncate">{p.name}</div>
                            <div className="text-[11px] text-muted truncate">{p.path}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => unarchiveProject.mutate(p.id)}
                            disabled={unarchiveProject.isPending}
                          >
                            Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </TabsContent>

              <TabsContent value="issues">
                <section className="mb-8">
                  <p className="mb-3 text-xs text-secondary">
                    Archived issues are closed on GitHub and hidden from the board. Restoring brings
                    them back locally but does not reopen them on GitHub.
                  </p>
                  {archivedIssues.length === 0 ? (
                    <p className="text-[13px] text-muted">No archived issues.</p>
                  ) : (
                    <div className="space-y-1">
                      {archivedIssues.map((issue) => (
                        <div
                          key={issue.id}
                          className="flex items-center justify-between rounded-md border border-border bg-tertiary px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-primary">
                              #{issue.issueNumber} {issue.title}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => unarchiveIssue.mutate(issue.id)}
                            disabled={unarchiveIssue.isPending}
                          >
                            Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

function ShortcutsSection() {
  const byCategory = SHORTCUTS.reduce<Record<ShortcutCategory, ShortcutDef[]>>(
    (acc, shortcut) => {
      (acc[shortcut.category] ??= []).push(shortcut);
      return acc;
    },
    {} as Record<ShortcutCategory, ShortcutDef[]>,
  );

  return (
    <>
      <h3 className="mb-1">Keyboard Shortcuts</h3>
      <p className="mb-6 text-xs text-muted">
        Reference of every shortcut in ShipCode. Remapping isn't supported yet — if you want a
        different binding, edit{' '}
        <code className="rounded bg-tertiary px-1 py-0.5 text-[11px]">
          apps/desktop/src/renderer/data/shortcuts.ts
        </code>
        .
      </p>
      {(Object.entries(byCategory) as [ShortcutCategory, ShortcutDef[]][]).map(
        ([category, items]) => (
          <section key={category} className="mb-6">
            <h4 className="mb-2 text-xs uppercase tracking-wide text-muted">{category}</h4>
            <div className="divide-y divide-border rounded-md border border-border bg-tertiary">
              {items.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-primary">{shortcut.label}</div>
                    <div className="text-[11px] text-muted">{shortcut.description}</div>
                  </div>
                  <kbd className="shrink-0 rounded border border-border bg-primary px-2 py-1 font-mono text-[12px] tracking-widest text-secondary">
                    {shortcut.glyph}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        ),
      )}
    </>
  );
}
