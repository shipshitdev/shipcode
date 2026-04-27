import type { AppSettings, DeveloperInfo, UpdateStatus } from '@shipcode/shared';
import {
  Button,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Terminal,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export function DeveloperSettingsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  const [isCopied, setIsCopied] = useState(false);

  const queryClient = useQueryClient();

  const { data: info } = useQuery<DeveloperInfo>({
    queryKey: ['developer-info'],
    queryFn: () => window.shipcode.invoke('developer:get-info'),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: updateStatus } = useQuery<UpdateStatus>({
    queryKey: ['update-status'],
    queryFn: () => window.shipcode.invoke('update:get-status'),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!window.shipcode?.on) return;
    const unsub = window.shipcode.on('update:status-changed', (next: UpdateStatus) => {
      queryClient.setQueryData(['update-status'], next);
    });
    return unsub;
  }, [queryClient]);

  const checkForUpdates = useMutation({
    mutationFn: () => window.shipcode.invoke('update:check-now'),
    onSuccess: (next) => queryClient.setQueryData(['update-status'], next),
  });

  const openExternal = (url: string) => window.shipcode.invoke('shell:open-external', { url });

  const handleCopyDiagnostics = async () => {
    if (!info) return;
    const lines = [
      `ShipCode v${info.appVersion}`,
      `Electron ${info.electronVersion} / Node ${info.nodeVersion}`,
      `${info.platform} (${info.osRelease})`,
      '',
      `claude: ${info.cliVersions.claude ?? 'not found'}`,
      `codex: ${info.cliVersions.codex ?? 'not found'}`,
      `git: ${info.cliVersions.git ?? 'not found'}`,
      `gh: ${info.cliVersions.gh ?? 'not found'}`,
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleLogLevelChange = (value: string) => {
    const level = value as AppSettings['devLogLevel'];
    onUpdate({ devLogLevel: level });
    void window.shipcode.invoke('developer:set-log-level', { level });
  };

  return (
    <>
      <h3 className="mb-5">Developer</h3>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">App Info</h4>
        <SettingsRow label="ShipCode version">
          <code className="text-sm text-secondary">{info?.appVersion ?? '...'}</code>
        </SettingsRow>
        <SettingsRow label="Electron">
          <span className="text-sm text-secondary">{info?.electronVersion ?? '...'}</span>
        </SettingsRow>
        <SettingsRow label="Node">
          <span className="text-sm text-secondary">{info?.nodeVersion ?? '...'}</span>
        </SettingsRow>
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Updates</h4>
        <SettingsRow
          label="Latest release"
          description={
            updateStatus?.error
              ? `Last check failed: ${updateStatus.error}`
              : updateStatus?.checkedAt
                ? `Checked ${new Date(updateStatus.checkedAt).toLocaleString()}`
                : 'No check yet — click Check now.'
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-secondary">
              {updateStatus?.latest
                ? updateStatus.hasUpdate
                  ? `v${updateStatus.latest} available`
                  : `v${updateStatus.latest} (up to date)`
                : '—'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => checkForUpdates.mutate()}
              disabled={checkForUpdates.isPending || updateStatus?.state === 'checking'}
            >
              <RefreshCw
                size={14}
                className={
                  checkForUpdates.isPending || updateStatus?.state === 'checking'
                    ? 'mr-1.5 animate-spin'
                    : 'mr-1.5'
                }
              />
              Check now
            </Button>
            {updateStatus?.releaseUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateStatus.releaseUrl ? void openExternal(updateStatus.releaseUrl) : undefined
                }
              >
                <ExternalLink size={14} className="mr-1.5" />
                Release notes
              </Button>
            )}
          </div>
        </SettingsRow>
        {updateStatus?.hasUpdate && (
          <SettingsRow
            label="Upgrade"
            description="ShipCode installs via Homebrew. Run this in your terminal."
          >
            <code className="rounded bg-tertiary px-2 py-1 font-mono text-xs text-secondary">
              brew upgrade --cask shipcode
            </code>
          </SettingsRow>
        )}
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Diagnostics</h4>
        <SettingsRow
          label="Copy diagnostics"
          description="Copies app version, OS, and CLI versions to clipboard for bug reports."
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={!info}
            onClick={() => void handleCopyDiagnostics()}
          >
            {isCopied ? (
              <>
                <Check size={14} className="mr-1.5" />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} className="mr-1.5" />
                Copy
              </>
            )}
          </Button>
        </SettingsRow>
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">DevTools</h4>
        <SettingsRow
          label="Chrome DevTools"
          description="Opens the renderer DevTools panel in a detached window."
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void window.shipcode.invoke('developer:open-devtools')}
          >
            <Terminal size={14} className="mr-1.5" />
            Open DevTools
          </Button>
        </SettingsRow>
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Logs</h4>
        <SettingsRow label="Log files" description="Reveals the electron-log directory in Finder.">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void window.shipcode.invoke('developer:open-log-directory')}
          >
            <FolderOpen size={14} className="mr-1.5" />
            Open in Finder
          </Button>
        </SettingsRow>
        <SettingsRow
          label="File log level"
          htmlFor="dev-log-level"
          description="Changes what severity gets written to the log file. Takes effect immediately."
        >
          <Select value={settings.devLogLevel} onValueChange={handleLogLevelChange}>
            <SelectTrigger id="dev-log-level" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </section>
    </>
  );
}
