import { HOMEBREW_UPDATE_COMMAND, type UpdateStatus } from '@shipcode/shared';
import { Alert, AlertDescription, Button } from '@shipshitdev/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useCopyFeedback } from '../hooks/useCopyFeedback';
import { useUpdateStatus } from '../hooks/useUpdateStatus';

export function UpdateBanner() {
  const queryClient = useQueryClient();
  const { copied, copy } = useCopyFeedback();
  const status = useUpdateStatus();

  const handleCopy = () => copy(HOMEBREW_UPDATE_COMMAND);

  const dismissUpdate = (releaseTag: string) => {
    queryClient.setQueryData<UpdateStatus | undefined>(['update-status'], (current) =>
      current?.releaseTag === releaseTag ? { ...current, hasUpdate: false } : current,
    );
  };

  if (!status?.hasUpdate || !status.latest) return null;

  return (
    <Alert
      variant="default"
      className="flex items-center gap-2 rounded-none border-x-0 border-t-0 border-b border-accent/30 bg-accent/8 px-4 py-2 text-xs"
    >
      <span className="text-base font-bold leading-none text-accent">↑</span>
      <AlertDescription className="text-xs text-accent">
        ShipCode v{status.latest} is available. You're on v{status.current}. Upgrade with{' '}
        <code className="rounded bg-accent/15 px-1 py-0.5 font-mono text-[11px]">
          {HOMEBREW_UPDATE_COMMAND}
        </code>
      </AlertDescription>
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-accent hover:bg-accent/15"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {status.releaseUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-accent hover:bg-accent/15"
            onClick={() =>
              void window.shipcode.invoke('shell:open-external', { url: status.releaseUrl })
            }
          >
            <ExternalLink size={12} />
            Release notes
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground hover:bg-accent/10 hover:text-accent"
          onClick={() => {
            if (status.releaseTag) dismissUpdate(status.releaseTag);
          }}
        >
          Dismiss
        </Button>
      </div>
    </Alert>
  );
}
