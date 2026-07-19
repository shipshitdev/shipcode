import type { AppSettings, DeveloperInfo, UpdateStatus } from '@shipcode/shared';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';

const UPDATE_TRACK_OPTIONS: Array<{
  value: AppSettings['updateTrack'];
  label: string;
  disabled?: boolean;
}> = [
  { value: 'master', label: 'Master' },
  { value: 'stable', label: 'Stable (reserved)', disabled: true },
  { value: 'nightly', label: 'Nightly (reserved)', disabled: true },
];

function updateStatusLabel(status: UpdateStatus | undefined): string {
  if (!status) return 'Check now';
  if (status.state === 'checking') return 'Checking';
  if (status.hasUpdate && status.latest) return `v${status.latest} available`;
  if (status.state === 'up-to-date') return 'Up to date';
  if (status.state === 'error') return 'Check failed';
  return 'Check now';
}

function updateStatusDescription(status: UpdateStatus | undefined): string {
  if (!status?.checkedAt) return 'No update check has run yet.';
  const checkedAt = new Date(status.checkedAt).toLocaleString();
  return status.error
    ? `Last check failed at ${checkedAt}: ${status.error}`
    : `Checked ${checkedAt}`;
}

export function AboutSettingsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  const queryClient = useQueryClient();

  const { data: info } = useQuery<DeveloperInfo>({
    queryKey: ['developer-info'],
    queryFn: () => window.shipcode.invoke('developer:get-info'),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const updateStatus = useUpdateStatus();

  const checkForUpdates = useMutation({
    mutationFn: () => window.shipcode.invoke('update:check-now'),
    onSuccess: (next) => queryClient.setQueryData(['update-status'], next),
  });

  const handleUpdateTrackChange = (value: string) => {
    onUpdate({ updateTrack: value as AppSettings['updateTrack'] });
  };

  const isChecking = checkForUpdates.isPending || updateStatus?.state === 'checking';

  return (
    <>
      <h3 className="mb-5">About</h3>

      <SettingsSection title="Updates">
        <SettingsRow
          label="Version"
          description={`Current version of the application. ${updateStatusDescription(updateStatus)}`}
        >
          <div className="flex items-center gap-3">
            <code className="font-mono text-sm text-secondary">{info?.appVersion ?? '...'}</code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => checkForUpdates.mutate()}
              disabled={isChecking}
            >
              <RefreshCw size={14} className={isChecking ? 'mr-1.5 animate-spin' : 'mr-1.5'} />
              {updateStatusLabel(updateStatus)}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Update track"
          htmlFor="update-track"
          description="Master is the only published update track today. Stable and nightly are reserved for later desktop channels."
        >
          <Select value={settings.updateTrack} onValueChange={handleUpdateTrackChange}>
            <SelectTrigger id="update-track" className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UPDATE_TRACK_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
