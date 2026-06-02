import type { IssuePipelineStatus } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS } from '@shipcode/shared';
import { Badge, cn } from '@shipshitdev/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { IssueGraphNodeData } from './issue-graph-utils';

const STATUS_STYLES: Record<IssuePipelineStatus, string> = {
  todo: 'border-border-strong bg-elevated',
  queued: 'border-info/60 bg-elevated',
  planning: 'border-agent/60 bg-elevated',
  clarifying: 'border-warning/60 bg-elevated',
  reviewing: 'border-agent/60 bg-elevated',
  revising: 'border-agent/60 bg-elevated',
  approval: 'border-warning/60 bg-elevated',
  needs_review: 'border-warning/60 bg-elevated',
  ready_to_merge: 'border-warning/60 bg-elevated',
  paused: 'border-warning/60 bg-elevated',
  executing: 'border-success/60 bg-elevated',
  testing: 'border-success/60 bg-elevated',
  verifying: 'border-success/60 bg-elevated',
  shipping: 'border-success/60 bg-elevated',
  completed: 'border-success/60 bg-elevated',
  closed: 'border-success/60 bg-elevated',
  deferred: 'border-border-strong bg-elevated',
  failed: 'border-danger/60 bg-elevated',
};

export function IssueGraphNode({ data, selected }: NodeProps) {
  const payload = data as IssueGraphNodeData;

  return (
    <div
      className={cn(
        'w-72 rounded-md border px-4 py-3 shadow-sm shadow-black/25 transition-shadow',
        STATUS_STYLES[payload.pipelineStatus],
        payload.state === 'closed' && 'opacity-75',
        selected && 'ring-2 ring-agent/50 shadow-lg',
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-agent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-secondary">
            #{payload.issueNumber}
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-primary">
            {payload.title}
          </div>
        </div>
        <Badge
          variant={
            payload.pipelineStatus === ISSUE_PIPELINE_STATUS.failed
              ? 'danger'
              : payload.pipelineStatus === ISSUE_PIPELINE_STATUS.paused
                ? 'warning'
                : 'info'
          }
          className="shrink-0 px-1.5 py-px text-[10px]"
        >
          {payload.pipelineStatus}
        </Badge>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-0 !bg-success"
      />
    </div>
  );
}
