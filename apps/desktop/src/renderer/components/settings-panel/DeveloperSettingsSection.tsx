import type { AppSettings, DeveloperInfo } from '@shipcode/shared';
import { SettingsSection } from '@shipcode/ui';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, FolderOpen, Terminal } from 'lucide-react';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';

export function DeveloperSettingsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  const { copied: isCopied, copy } = useCopyFeedback({ resetMs: 2000 });

  const { data: info } = useQuery<DeveloperInfo>({
    queryKey: ['developer-info'],
    queryFn: () => window.shipcode.invoke('developer:get-info'),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const handleCopyDiagnostics = async (developerInfo: DeveloperInfo) => {
    const lines = [
      `ShipCode v${developerInfo.appVersion}`,
      `Electron ${developerInfo.electronVersion} / Node ${developerInfo.nodeVersion}`,
      `${developerInfo.platform} (${developerInfo.osRelease})`,
      '',
      `claude: ${developerInfo.cliVersions.claude ?? 'not found'}`,
      `codex: ${developerInfo.cliVersions.codex ?? 'not found'}`,
      `git: ${developerInfo.cliVersions.git ?? 'not found'}`,
      `gh: ${developerInfo.cliVersions.gh ?? 'not found'}`,
    ];
    await copy(lines.join('\n'));
  };

  const handleLogLevelChange = (value: string) => {
    const level = value as AppSettings['devLogLevel'];
    onUpdate({ devLogLevel: level });
    void window.shipcode.invoke('developer:set-log-level', { level });
  };

  return (
    <>
      <h3 className="mb-5">Developer</h3>

      <SettingsSection title="App Info">
        <SettingsRow label="ShipCode version">
          <code className="text-sm text-secondary">{info?.appVersion ?? '...'}</code>
        </SettingsRow>
        <SettingsRow label="Electron">
          <span className="text-sm text-secondary">{info?.electronVersion ?? '...'}</span>
        </SettingsRow>
        <SettingsRow label="Node">
          <span className="text-sm text-secondary">{info?.nodeVersion ?? '...'}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Diagnostics">
        <SettingsRow
          label="Copy diagnostics"
          description="Copies app version, OS, and CLI versions to clipboard for bug reports."
        >
          {info ? (
            <Button variant="secondary" size="sm" onClick={() => void handleCopyDiagnostics(info)}>
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
          ) : (
            <Button variant="secondary" size="sm" disabled>
              <Copy size={14} className="mr-1.5" />
              Copy
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="DevTools">
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
      </SettingsSection>

      <SettingsSection title="Logs">
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
      </SettingsSection>
    </>
  );
}
