import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { InAppNotification } from '../InAppNotification';

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
      <div className="flex justify-start">
        <InAppNotification
          title={actionBanner.label}
          description={
            pinnedIssue
              ? `#${pinnedIssue.issueNumber} ${pinnedIssue.title} - click to open`
              : 'Click to open Issue Detail'
          }
          tone="warning"
          className="w-full max-w-[20rem]"
          onClick={onOpen}
          onDismiss={onDismiss}
        />
      </div>
    </div>
  );
}
