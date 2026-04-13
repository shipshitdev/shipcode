import { useState } from 'react';
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
import { DEFAULT_SETTINGS, type AppSettings, type GitHubIssueCacheRecord, type Project } from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';
import { SHORTCUTS, type ShortcutCategory, type ShortcutDef } from '../data/shortcuts';

type ExecutorModel = 'claude' | 'codex' | 'openrouter';

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
}) {
  return (
    <>
      <SettingsRow label={label} htmlFor={htmlFor}>
        <Select value={modelValue} onValueChange={onModelChange}>
          <SelectTrigger id={htmlFor} className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {validProviders.includes('claude') && <SelectItem value="claude">Claude</SelectItem>}
            {validProviders.includes('codex') && <SelectItem value="codex">Codex</SelectItem>}
            {validProviders.includes('openrouter') && <SelectItem value="openrouter">OpenRouter</SelectItem>}
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
                validProviders={['claude', 'openrouter']}
                onModelChange={(v) => updateSettings.mutate({ plannerModel: v as AppSettings['plannerModel'] })}
                onOpenrouterModelChange={(v) => updateSettings.mutate({ openrouterPlannerModel: v })}
                onReasoningEffortChange={(v) => updateSettings.mutate({ plannerReasoningEffort: v })}
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
              />
              <PhaseModelRow
                label="Verifier model"
                htmlFor="verifier-model"
                modelValue={settings.verifierModel}
                openrouterModelValue={settings.openrouterVerifierModel}
                reasoningEffortValue={settings.verifierReasoningEffort}
                validProviders={['claude', 'openrouter']}
                onModelChange={(v) => updateSettings.mutate({ verifierModel: v as AppSettings['verifierModel'] })}
                onOpenrouterModelChange={(v) => updateSettings.mutate({ openrouterVerifierModel: v })}
                onReasoningEffortChange={(v) => updateSettings.mutate({ verifierReasoningEffort: v })}
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
