import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { Button, X } from '@shipcode/ui';

interface TerminalDrawerActionBannerProps {
  actionBanner: {
    label: string;
    action: 'open-issue-detail';
  };
  pinnedIssue: GitHubIssueCacheRecord | null;
  onDismiss: () => void;
  onOpen: () => void;
}

export function TerminalDrawerActionBanner({
  actionBanner,
  pinnedIssue,
  onDismiss,
  onOpen,
}: TerminalDrawerActionBannerProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
      <div className="group flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 shadow-lg backdrop-blur-sm">
        <Button
          variant="ghost"
          onClick={onOpen}
          className="h-auto flex-1 justify-start whitespace-normal px-0 py-0 text-left font-normal hover:bg-transparent"
        >
          <div className="flex flex-col items-start gap-0.5">
            <div className="text-[12px] font-semibold text-primary">{actionBanner.label}</div>
            <div className="text-[11px] text-secondary">
              {pinnedIssue
                ? `#${pinnedIssue.issueNumber} ${pinnedIssue.title} -- click to open`
                : 'Click to open Issue Detail'}
            </div>
          </div>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          className="text-muted hover:bg-transparent hover:text-primary"
          title="Dismiss"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
