import type {
  AppSettings,
  DesktopAppHealth,
  IntegrationStatus,
  ProjectOpenTarget,
} from '@shipcode/shared';
import { SettingsSection } from '@shipcode/ui';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { FolderGit, Sparkles, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

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
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function useIntegrationsSettingsSectionView({
  integrationStatus,
  integrationsFetching,
  settings,
  onUpdate,
  onRefetch,
  onTestChat,
}: {
  integrationStatus: IntegrationStatus | undefined;
  integrationsFetching: boolean;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onRefetch: () => void;
  onTestChat: (provider: 'discord' | 'telegram') => Promise<string>;
}) {
  const [discordTestResult, setDiscordTestResult] = useState<string | null>(null);
  const [telegramTestResult, setTelegramTestResult] = useState<string | null>(null);
  const getOpenRouterModelPresentation = (
    check: NonNullable<IntegrationStatus>['openrouter']['modelChecks'][number],
  ) => {
    const disabled =
      check.status === 'unverified' &&
      integrationStatus?.openrouter &&
      integrationStatus.openrouter.authStatus === 'missing_key';

    return {
      tone:
        check.status === 'valid'
          ? 'success'
          : check.status === 'invalid'
            ? 'danger'
            : check.status === 'unverified' && !disabled
              ? 'warning'
              : 'neutral',
      label: check.status === 'unverified' && disabled ? 'disabled' : check.status,
    } as const;
  };

  const getCliVersionLine = (version: string | null) => version?.split('\n')[0]?.trim() ?? null;
  const missingCli = {
    available: false,
    version: null,
    path: null,
    error: null,
    authenticated: false,
  };
  const projectOpenTargets: ProjectOpenTarget[] = [
    'cursor',
    'finder',
    'terminal',
    'ghostty',
    'vscode',
    't3code',
  ];
  const projectOpenTargetLabels: Record<ProjectOpenTarget, string> = {
    cursor: 'Cursor',
    finder: 'Finder',
    terminal: 'Terminal',
    ghostty: 'Ghostty',
    vscode: 'Visual Studio Code',
    t3code: 'T3 Code',
  };
  const terminalOpenTargets: AppSettings['terminalOpenTarget'][] = ['terminal', 'ghostty'];
  const getDesktopApp = (target: ProjectOpenTarget): DesktopAppHealth =>
    integrationStatus?.desktopApps?.[target] ?? {
      key: target,
      label: projectOpenTargetLabels[target],
      available: false,
      path: null,
      error: null,
    };
  const terminalOpenerSection = (
    <SettingsSection
      title="Terminal opener"
      description="Choose the terminal ShipCode opens from Terminal and the console drawer."
      className="mb-6"
    >
      <div className="mb-4 flex max-w-[260px] flex-col gap-1.5">
        <label htmlFor="terminal-open-target" className="text-[11px] text-secondary">
          Default terminal
        </label>
        <Select
          value={settings.terminalOpenTarget}
          onValueChange={(value) =>
            onUpdate({ terminalOpenTarget: value as AppSettings['terminalOpenTarget'] })
          }
        >
          <SelectTrigger id="terminal-open-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {terminalOpenTargets.map((target) => {
              const app = getDesktopApp(target);
              return (
                <SelectItem key={target} value={target} disabled={!app.available}>
                  {app.label}
                  {!app.available ? ' (Unavailable)' : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {terminalOpenTargets.map((target) => {
          const app = getDesktopApp(target);
          return (
            <div key={target} className="rounded-md border border-border bg-primary/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-[140px] text-[13px] font-medium text-primary">
                  {app.label}
                </div>
                <StatusPill tone={app.available ? 'success' : 'neutral'}>
                  {app.available ? 'Available' : 'Unavailable'}
                </StatusPill>
              </div>
              <div className="mt-2 space-y-1 text-[12px] text-secondary">
                {app.path ? (
                  <div>
                    Path: <code>{app.path}</code>
                  </div>
                ) : null}
                {app.error ? <div className="text-amber-300">{app.error}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
  const projectOpenerSection = (
    <SettingsSection
      title="Project opener"
      description="Choose the default app ShipCode uses when you open a project folder from the topbar."
      className="mb-6"
    >
      <div className="mb-4 flex max-w-[260px] flex-col gap-1.5">
        <label htmlFor="project-open-target" className="text-[11px] text-secondary">
          Default app
        </label>
        <Select
          value={settings.projectOpenTarget}
          onValueChange={(value) =>
            onUpdate({ projectOpenTarget: value as AppSettings['projectOpenTarget'] })
          }
        >
          <SelectTrigger id="project-open-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projectOpenTargets.map((target) => {
              const app = getDesktopApp(target);
              return (
                <SelectItem key={target} value={target} disabled={!app.available}>
                  {app.label}
                  {!app.available ? ' (Unavailable)' : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {projectOpenTargets.map((target) => {
          const app = getDesktopApp(target);
          return (
            <div key={target} className="rounded-md border border-border bg-primary/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-[140px] text-[13px] font-medium text-primary">
                  {app.label}
                </div>
                <StatusPill tone={app.available ? 'success' : 'neutral'}>
                  {app.available ? 'Available' : 'Unavailable'}
                </StatusPill>
              </div>
              <div className="mt-2 space-y-1 text-[12px] text-secondary">
                {app.path ? (
                  <div>
                    Path: <code>{app.path}</code>
                  </div>
                ) : null}
                {app.error ? <div className="text-amber-300">{app.error}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h3>Integrations</h3>
          <p className="mt-1 text-xs text-secondary">
            CLI and provider readiness. API keys remain env-managed for now.
          </p>
        </div>
        <Button variant="secondary" onClick={onRefetch} disabled={integrationsFetching}>
          <LoadingButtonContent loading={integrationsFetching}>Re-check</LoadingButtonContent>
        </Button>
      </div>

      {!integrationStatus ? (
        <div className="text-[13px] text-muted-foreground">Loading integration status…</div>
      ) : (
        <Tabs defaultValue="cli">
          <TabsList className="mb-5">
            <TabsTrigger value="cli">CLI</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="ide">IDE</TabsTrigger>
          </TabsList>

          <TabsContent value="cli" className="mt-0 space-y-2">
            {[
              { key: 'claude', label: 'Claude CLI' },
              { key: 'codex', label: 'Codex CLI' },
              { key: 'gemini', label: 'Gemini CLI' },
              { key: 'gh', label: 'GitHub CLI' },
            ].map(({ key, label }) => {
              const cli =
                key === 'claude'
                  ? integrationStatus.system.claude
                  : key === 'codex'
                    ? integrationStatus.system.codex
                    : key === 'gemini'
                      ? (integrationStatus.system.gemini ?? missingCli)
                      : integrationStatus.system.gh;
              const ghScope =
                key === 'gh'
                  ? integrationStatus.ghAuth.hasProjectScope === true
                    ? 'project scope granted'
                    : integrationStatus.ghAuth.hasProjectScope === false
                      ? 'project scope missing'
                      : null
                  : null;
              const versionLine = getCliVersionLine(cli.version);
              const Icon =
                key === 'claude' || key === 'gemini'
                  ? Sparkles
                  : key === 'codex'
                    ? Terminal
                    : FolderGit;
              const modelCapabilities =
                key === 'claude' || key === 'codex' || key === 'gemini'
                  ? integrationStatus.modelCapabilities?.[key]
                  : null;

              return (
                <div key={key} className="rounded-md border border-border bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-[110px] items-center gap-2 text-[13px] font-medium text-primary">
                      <span className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-tertiary text-secondary">
                        <Icon size={15} />
                      </span>
                      <span>{label}</span>
                    </div>
                    <div className="ml-auto flex flex-wrap justify-end gap-2">
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
                      {ghScope ? (
                        <StatusPill
                          tone={integrationStatus.ghAuth.hasProjectScope ? 'success' : 'warning'}
                        >
                          {ghScope}
                        </StatusPill>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-[12px] text-secondary">
                    {versionLine ? (
                      <div>
                        Version: <code>{versionLine}</code>
                      </div>
                    ) : null}
                    {cli.path ? (
                      <div>
                        Path: <code>{cli.path}</code>
                      </div>
                    ) : null}
                    {modelCapabilities ? (
                      <div>
                        Models:{' '}
                        <code>
                          {modelCapabilities.models.length > 0
                            ? modelCapabilities.models.map((model) => model.value).join(', ')
                            : 'none reported'}
                        </code>
                      </div>
                    ) : null}
                    {modelCapabilities?.error ? (
                      <div className="text-amber-300">{modelCapabilities.error}</div>
                    ) : null}
                    {key === 'gh' && integrationStatus.ghAuth.username ? (
                      <div>
                        Account: <code>@{integrationStatus.ghAuth.username}</code>
                      </div>
                    ) : null}
                    {cli.error ? <div className="text-red-300">{cli.error}</div> : null}
                    {key === 'gh' && integrationStatus.ghAuth.hasProjectScope === false ? (
                      <div className="text-amber-300">
                        Run <code>gh auth refresh -s project</code> to attach issues to project
                        boards.
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="api-keys" className="mt-0">
            <SettingsSection title="API Keys">
              <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] text-secondary">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <span className="text-[13px] font-medium text-primary">OpenRouter</span>
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    <StatusPill
                      tone={integrationStatus.openrouter.keyPresent ? 'success' : 'warning'}
                    >
                      {integrationStatus.openrouter.keyPresent
                        ? 'OPENROUTER_API_KEY detected'
                        : 'OPENROUTER_API_KEY missing'}
                    </StatusPill>
                    <StatusPill
                      tone={
                        integrationStatus.openrouter.authStatus === 'valid' ? 'success' : 'warning'
                      }
                    >
                      {integrationStatus.openrouter.authStatus}
                    </StatusPill>
                  </div>
                </div>
                <div className="space-y-1">
                  <div>
                    ShipCode currently reads <code>OPENROUTER_API_KEY</code> from the environment
                    exposed to the desktop app.
                  </div>
                  {integrationStatus.openrouter.label ? (
                    <div>
                      Key label: <code>{integrationStatus.openrouter.label}</code>
                    </div>
                  ) : null}
                  {integrationStatus.openrouter.message ? (
                    <div className="text-amber-300">{integrationStatus.openrouter.message}</div>
                  ) : null}
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title="Chat Providers">
              <div className="space-y-4">
                <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] text-secondary">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-primary">Discord</span>
                    <div className="ml-auto flex flex-wrap justify-end gap-2">
                      <StatusPill
                        tone={
                          integrationStatus.discord.validationStatus === 'valid'
                            ? 'success'
                            : integrationStatus.discord.validationStatus === 'invalid'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {integrationStatus.discord.validationStatus}
                      </StatusPill>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="settings-discord-enabled"
                      className="flex items-center justify-between gap-3"
                    >
                      <span>Enable Discord chat alerts</span>
                      <Switch
                        id="settings-discord-enabled"
                        checked={settings.discordEnabled}
                        onCheckedChange={(checked) => onUpdate({ discordEnabled: checked })}
                      />
                    </label>
                    <Input
                      value={settings.discordWebhookUrl ?? ''}
                      onChange={(e) => onUpdate({ discordWebhookUrl: e.target.value || null })}
                      placeholder="https://discord.com/api/webhooks/..."
                      spellCheck={false}
                    />
                    {integrationStatus.discord.message ? (
                      <div className="text-amber-300">{integrationStatus.discord.message}</div>
                    ) : null}
                    {integrationStatus.discord.lastDeliveryStatus?.lastError ? (
                      <div className="text-amber-300">
                        Last delivery: {integrationStatus.discord.lastDeliveryStatus.lastError}
                      </div>
                    ) : integrationStatus.discord.lastDeliveryStatus?.lastSuccessAt ? (
                      <div>
                        Last delivery succeeded at{' '}
                        <code>{integrationStatus.discord.lastDeliveryStatus.lastSuccessAt}</code>
                      </div>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onTestChat('discord').then(setDiscordTestResult)}
                    >
                      Send test message
                    </Button>
                    {discordTestResult ? (
                      <div className="text-[12px] text-secondary">{discordTestResult}</div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] text-secondary">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-primary">Telegram</span>
                    <div className="ml-auto flex flex-wrap justify-end gap-2">
                      <StatusPill
                        tone={
                          integrationStatus.telegram.validationStatus === 'valid'
                            ? 'success'
                            : integrationStatus.telegram.validationStatus === 'invalid'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {integrationStatus.telegram.validationStatus}
                      </StatusPill>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="settings-telegram-enabled"
                      className="flex items-center justify-between gap-3"
                    >
                      <span>Enable Telegram chat alerts</span>
                      <Switch
                        id="settings-telegram-enabled"
                        checked={settings.telegramEnabled}
                        onCheckedChange={(checked) => onUpdate({ telegramEnabled: checked })}
                      />
                    </label>
                    <Input
                      value={settings.telegramBotToken ?? ''}
                      onChange={(e) => onUpdate({ telegramBotToken: e.target.value || null })}
                      placeholder="Bot token"
                      spellCheck={false}
                    />
                    <Input
                      value={settings.telegramDefaultChatId ?? ''}
                      onChange={(e) => onUpdate({ telegramDefaultChatId: e.target.value || null })}
                      placeholder="Default chat ID"
                      spellCheck={false}
                    />
                    {integrationStatus.telegram.message ? (
                      <div className="text-amber-300">{integrationStatus.telegram.message}</div>
                    ) : null}
                    {integrationStatus.telegram.lastDeliveryStatus?.lastError ? (
                      <div className="text-amber-300">
                        Last delivery: {integrationStatus.telegram.lastDeliveryStatus.lastError}
                      </div>
                    ) : integrationStatus.telegram.lastDeliveryStatus?.lastSuccessAt ? (
                      <div>
                        Last delivery succeeded at{' '}
                        <code>{integrationStatus.telegram.lastDeliveryStatus.lastSuccessAt}</code>
                      </div>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onTestChat('telegram').then(setTelegramTestResult)}
                    >
                      Send test message
                    </Button>
                    {telegramTestResult ? (
                      <div className="text-[12px] text-secondary">{telegramTestResult}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title="OpenRouter Models">
              <div className="space-y-2">
                {integrationStatus.openrouter.modelChecks.map((check) => {
                  const presentation = getOpenRouterModelPresentation(check);
                  return (
                    <div
                      key={check.key}
                      className="rounded-md border border-border bg-secondary/40 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-[140px] text-[13px] font-medium text-primary">
                          {check.label}
                        </div>
                        <div className="ml-auto flex flex-wrap justify-end gap-2">
                          <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 text-[12px] text-secondary">
                        <div>
                          Model: <code>{check.modelId ?? '(not configured)'}</code>
                        </div>
                        {check.message ? (
                          <div className="text-amber-300">{check.message}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="ide" className="mt-0">
            {terminalOpenerSection}
            {projectOpenerSection}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

export function IntegrationsSettingsSection(
  props: Parameters<typeof useIntegrationsSettingsSectionView>[0],
) {
  return useIntegrationsSettingsSectionView(props);
}
