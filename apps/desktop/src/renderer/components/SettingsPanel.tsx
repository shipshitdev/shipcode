import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  Project,
} from '@shipcode/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAppSettings } from '../hooks/useAppSettings';
import { useTelemetryStatus } from '../hooks/useTelemetryStatus';
import { useAppStore } from '../stores/app-store';
import { AboutSettingsSection } from './settings-panel/AboutSettingsSection';
import { ArchivedSettingsSection } from './settings-panel/ArchivedSettingsSection';
import { AutoCommitSettingsSection } from './settings-panel/AutoCommitSettingsSection';
import { DeveloperSettingsSection } from './settings-panel/DeveloperSettingsSection';
import { GeneralSettingsSection } from './settings-panel/GeneralSettingsSection';
import { GithubSettingsSection } from './settings-panel/GithubSettingsSection';
import { IntegrationsSettingsSection } from './settings-panel/IntegrationsSettingsSection';
import { NotificationsSettingsSection } from './settings-panel/NotificationsSettingsSection';
import { PipelineSettingsSection } from './settings-panel/PipelineSettingsSection';
import { ShortcutsSection } from './settings-panel/ShortcutsSection';

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const settingsSection = useAppStore((state) => state.settingsSection);
  const [worktreeRootError, setWorktreeRootError] = useState<string | null>(null);

  const { data: settings } = useAppSettings();
  const { data: telemetryStatus } = useTelemetryStatus();

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.shipcode.invoke('settings:set', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['telemetry-status'] });
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
    mutationFn: (issueId: string) => window.shipcode.invoke('github:unarchive-issue', { issueId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues-archived'] });
      queryClient.invalidateQueries({ queryKey: ['github-issues'] });
    },
  });

  const { data: integrationStatus, isFetching: integrationsFetching } = useQuery<IntegrationStatus>(
    {
      queryKey: ['integrations'],
      queryFn: () => window.shipcode.invoke('integrations:check'),
      enabled:
        settingsSection === 'integrations' ||
        settingsSection === 'pipeline' ||
        settingsSection === 'auto-commit',
      staleTime: 30_000,
    },
  );

  const refreshIntegrations = useMutation({
    mutationFn: () =>
      window.shipcode.invoke<IntegrationStatus>('integrations:check', { force: true }),
    onSuccess: (freshStatus) => {
      queryClient.setQueryData(['integrations'], freshStatus);
    },
  });

  if (!settings) return null;

  const update = (patch: Partial<AppSettings>) => updateSettings.mutate(patch);
  const testChat = async (provider: 'discord' | 'telegram') => {
    const result = await window.shipcode.invoke<{ ok: boolean; message: string }>(
      'integrations:test-chat',
      { provider },
    );
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    return result.message;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-primary p-8">
      <div key={settingsSection} className="max-w-2xl animate-settings-enter">
        {settingsSection === 'general' && (
          <GeneralSettingsSection
            settings={settings}
            telemetryStatus={telemetryStatus}
            worktreeRootError={worktreeRootError}
            onUpdate={update}
            onUpdateWorktreeRoot={(value) => {
              setWorktreeRootError(null);
              updateSettings.mutate(
                { worktreeRoot: value },
                {
                  onError: (err: unknown) => {
                    setWorktreeRootError(err instanceof Error ? err.message : String(err));
                  },
                },
              );
            }}
          />
        )}
        {settingsSection === 'integrations' && (
          <IntegrationsSettingsSection
            integrationStatus={integrationStatus}
            integrationsFetching={integrationsFetching || refreshIntegrations.isPending}
            settings={settings}
            onUpdate={update}
            onSaveCredential={(patch) => updateSettings.mutateAsync(patch)}
            onRefetch={() => {
              refreshIntegrations.mutate();
            }}
            onTestChat={testChat}
          />
        )}
        {settingsSection === 'github' && (
          <GithubSettingsSection settings={settings} onUpdate={update} />
        )}
        {settingsSection === 'notifications' && (
          <NotificationsSettingsSection settings={settings} onUpdate={update} />
        )}
        {settingsSection === 'pipeline' && (
          <PipelineSettingsSection
            settings={settings}
            integrationStatus={integrationStatus}
            onUpdate={update}
          />
        )}
        {settingsSection === 'auto-commit' && (
          <AutoCommitSettingsSection
            settings={settings}
            integrationStatus={integrationStatus}
            onUpdate={update}
          />
        )}
        {settingsSection === 'shortcuts' && <ShortcutsSection />}
        {settingsSection === 'archived' && (
          <ArchivedSettingsSection
            archivedProjects={archivedProjects}
            archivedIssues={archivedIssues}
            unarchiveProjectPending={unarchiveProject.isPending}
            unarchiveIssuePending={unarchiveIssue.isPending}
            onUnarchiveProject={(projectId) => unarchiveProject.mutate(projectId)}
            onUnarchiveIssue={(issueId) => unarchiveIssue.mutate(issueId)}
          />
        )}
        {settingsSection === 'developer' && (
          <DeveloperSettingsSection settings={settings} onUpdate={update} />
        )}
        {settingsSection === 'about' && (
          <AboutSettingsSection settings={settings} onUpdate={update} />
        )}
      </div>
    </div>
  );
}
