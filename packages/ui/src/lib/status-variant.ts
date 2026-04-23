import type { IssuePipelineStatus, ThreadStatus } from './shipcode';

export type StatusBadgeVariant = 'default' | 'done' | 'success' | 'warning' | 'danger' | 'accent';

// Accepts both status unions — the only diff between them is:
//   IssuePipelineStatus: 'todo' | 'queued'  (→ default)
//   ThreadStatus:        'idle'             (→ default)
// All other cases are handled identically.
// No `default` arm — TS exhaustiveness catches new statuses.
export function getStatusBadgeVariant(
  status: IssuePipelineStatus | ThreadStatus,
): StatusBadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'done':
      return 'done';
    case 'failed':
      return 'danger';
    case 'awaiting_approval':
    case 'clarifying':
      return 'warning';
    case 'planning':
    case 'reviewing':
    case 'revising':
    case 'executing':
    case 'testing':
    case 'verifying':
    case 'shipping':
      return 'accent';
    case 'todo':
    case 'queued':
    case 'idle':
      return 'default';
  }
}
