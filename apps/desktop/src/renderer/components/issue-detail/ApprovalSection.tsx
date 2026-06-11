import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useState } from 'react';

interface ApprovalSectionProps {
  approveError: string | null;
  canApprove: boolean;
  isSubmitting: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onReject: (feedback: string) => void;
}

export function ApprovalSection({
  approveError,
  canApprove,
  isSubmitting,
  onApprove,
  onCancel,
  onReject,
}: ApprovalSectionProps) {
  const [pendingAction, setPendingAction] = useState<'approve' | 'request_changes' | 'cancel'>(
    'approve',
  );
  const [feedback, setFeedback] = useState('');

  const handleReject = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    onReject(trimmed);
    setFeedback('');
    setPendingAction('approve');
  };

  return (
    <div
      className="rounded-md border border-border bg-secondary p-3"
      data-testid="approval-section"
    >
      <div
        className={
          pendingAction === 'request_changes'
            ? 'mb-3 flex items-center gap-2'
            : 'flex items-center gap-2'
        }
      >
        <Select
          value={pendingAction}
          onValueChange={(value) =>
            setPendingAction(value as 'approve' | 'request_changes' | 'cancel')
          }
          disabled={isSubmitting}
        >
          <SelectTrigger className="h-8 w-48 text-[12px]" data-testid="approval-action-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approve">Approve &amp; Execute</SelectItem>
            <SelectItem value="request_changes">Request Changes</SelectItem>
            <SelectItem value="cancel">Cancel pipeline</SelectItem>
          </SelectContent>
        </Select>
        {pendingAction === 'approve' && (
          <Button
            size="sm"
            onClick={onApprove}
            disabled={isSubmitting || !canApprove}
            title={
              !canApprove ? 'No plan content found - use Request Changes or Cancel' : undefined
            }
            data-testid="approval-confirm-btn"
          >
            <LoadingButtonContent loading={isSubmitting}>Confirm</LoadingButtonContent>
          </Button>
        )}
        {pendingAction === 'cancel' && (
          <Button size="sm" variant="destructive" onClick={onCancel} disabled={isSubmitting}>
            <LoadingButtonContent loading={isSubmitting}>Confirm cancel</LoadingButtonContent>
          </Button>
        )}
      </div>
      {pendingAction === 'request_changes' && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Tell the planner what to change before the next pass..."
            rows={4}
            data-testid="approval-reject-textarea"
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReject}
              disabled={!feedback.trim() || isSubmitting}
            >
              <LoadingButtonContent loading={isSubmitting}>
                Resume planning with feedback
              </LoadingButtonContent>
            </Button>
          </div>
        </div>
      )}
      {approveError && (
        <p className="mt-2 text-[11px] text-danger">
          {approveError}{' '}
          <span className="text-muted-foreground">(full trace in devtools console)</span>
        </p>
      )}
    </div>
  );
}
