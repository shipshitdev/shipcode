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
} from '@shipcode/ui';
import type { AppSettings, Project } from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';

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
                label="Planner max turns"
                htmlFor="planner-max-turns"
                description="Max Claude turns for plan / revision / verify phases. Higher = more thorough but slower."
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
              <SettingsRow label="Executor model" htmlFor="executor-model">
                <Select
                  value={settings.executorModel}
                  onValueChange={(value: string) =>
                    updateSettings.mutate({ executorModel: value as AppSettings['executorModel'] })
                  }
                >
                  <SelectTrigger id="executor-model" className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">claude</SelectItem>
                    <SelectItem value="codex">codex</SelectItem>
                    <SelectItem value="openrouter">openrouter</SelectItem>
                  </SelectContent>
                </Select>
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

        {settingsSection === 'archived' && (
          <>
            <h3 className="mb-5">Archived</h3>
            <section className="mb-8">
              <h4 className="mb-3 text-secondary">Archived Projects</h4>
              <p className="mb-3 text-xs text-secondary">
                Archived projects are hidden from the sidebar but remain navigable via Activity and
                notifications. They re-appear automatically when new work arrives, or you can
                restore one manually here.
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
          </>
        )}
      </div>
    </div>
  );
}
