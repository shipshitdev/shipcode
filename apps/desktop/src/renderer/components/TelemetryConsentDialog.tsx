import type { AppSettings } from '@shipcode/shared';
import { Button, LoadingButtonContent } from '@shipshitdev/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface TelemetryConsentDialogProps {
  open: boolean;
}

export function TelemetryConsentDialog({ open }: TelemetryConsentDialogProps) {
  const queryClient = useQueryClient();
  const updateConsent = useMutation({
    mutationFn: (telemetryEnabled: boolean) =>
      window.shipcode.invoke('settings:set', { telemetryEnabled } satisfies Partial<AppSettings>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['telemetry-status'] });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-primary p-6 shadow-2xl shadow-black/40">
        <div className="mb-5 flex flex-col gap-2">
          <h2 className="text-base font-semibold text-primary">Error reporting</h2>
          <p className="text-sm leading-6 text-secondary">
            ShipCode can send anonymous crash and pipeline failure reports to Sentry. Reports
            include correlation metadata like thread id, project id, issue number, and current
            phase. They do not include prompts, terminal output, or raw agent logs.
          </p>
          <p className="text-sm leading-6 text-secondary">
            You can change this later in Settings / General. Local events stay in events.log either
            way.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={updateConsent.isPending}
            onClick={() => updateConsent.mutate(false)}
          >
            Decline
          </Button>
          <Button disabled={updateConsent.isPending} onClick={() => updateConsent.mutate(true)}>
            <LoadingButtonContent loading={updateConsent.isPending}>Allow</LoadingButtonContent>
          </Button>
        </div>
      </div>
    </div>
  );
}
