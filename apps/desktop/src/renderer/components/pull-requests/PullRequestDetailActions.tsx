import { Button } from '@shipcode/ui';
import { useState } from 'react';
import { useAppStore } from '../../stores/app-store';

export function PullRequestDetailActions({
  prNumber,
  prUrl,
  hasUnresolvedComments,
}: {
  prNumber: number;
  prUrl: string;
  hasUnresolvedComments: boolean;
}) {
  const { activeProjectId, setProjectTab } = useAppStore();
  const [isReviewing, setIsReviewing] = useState(false);
  const [isAddressing, setIsAddressing] = useState(false);

  const handleAiReview = async () => {
    if (!activeProjectId) return;
    setIsReviewing(true);
    try {
      const skillContent = await window.shipcode.invoke<string | null>('skills:load-content', {
        name: 'review-pr',
      });
      const result = await window.shipcode.invoke<{ threadId: string }>('instant:run', {
        projectId: activeProjectId,
        prompt: `Review PR #${prNumber} at ${prUrl}. Perform a thorough code review following the checklist in your system instructions.`,
        scope: 'project',
        cli: 'claude',
        customSystemPrompt: skillContent ?? undefined,
      });
      const { addInstantPane } = useAppStore.getState();
      addInstantPane(result.threadId);
      setProjectTab('sessions');
    } finally {
      setIsReviewing(false);
    }
  };

  const handleAddressComments = async () => {
    if (!activeProjectId) return;
    setIsAddressing(true);
    try {
      const skillContent = await window.shipcode.invoke<string | null>('skills:load-content', {
        name: 'gh-address-comments',
      });
      const result = await window.shipcode.invoke<{ threadId: string }>('instant:run', {
        projectId: activeProjectId,
        prompt: `Address the review comments on PR #${prNumber} at ${prUrl}. Follow the workflow in your system instructions to fetch, fix, and respond to each comment.`,
        scope: 'project',
        cli: 'claude',
        customSystemPrompt: skillContent ?? undefined,
      });
      const { addInstantPane } = useAppStore.getState();
      addInstantPane(result.threadId);
      setProjectTab('sessions');
    } finally {
      setIsAddressing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button onClick={() => void handleAiReview()} disabled={isReviewing}>
        {isReviewing ? 'Reviewing...' : 'AI Review'}
      </Button>
      {hasUnresolvedComments && (
        <Button
          variant="secondary"
          onClick={() => void handleAddressComments()}
          disabled={isAddressing}
        >
          {isAddressing ? 'Addressing...' : 'Address Comments'}
        </Button>
      )}
    </div>
  );
}
