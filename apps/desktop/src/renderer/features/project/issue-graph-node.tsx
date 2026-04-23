import type { IssuePipelineStatus } from '@shipcode/shared';
import { Badge, cn } from '@shipshitdev/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { IssueGraphNodeData } from './issue-graph-utils';

const STATUS_STYLES: Record<IssuePipelineStatus, string> = {
  todo: 'border-border bg-secondary/50',
  queued: 'border-accent/40 bg-accent/10',
  planning: 'border-agent/40 bg-agent/10',
  clarifying: 'border-warning/40 bg-warning/10',
  reviewing: 'border-agent/40 bg-agent/10',
  revising: 'border-agent/40 bg-agent/10',
  awaiting_approval: 'border-warning/40 bg-warning/10',
  executing: 'border-success/40 bg-success/10',
  testing: 'border-success/40 bg-success/10',
  verifying: 'border-success/40 bg-success/10',
  shipping: 'border-success/40 bg-success/10',
  completed: 'border-success/40 bg-success/10',
  done: 'border-success/40 bg-success/10',
  failed: 'border-danger/40 bg-danger/10',
};

export function IssueGraphNode({ data, selected }: NodeProps) {
  const payload = data as IssueGraphNodeData;

  return (
    <div
      className={cn(
        'min-w-[220px] rounded-xl border px-3 py-2 shadow-sm transition-shadow',
        STATUS_STYLES[payload.pipelineStatus],
        payload.state === 'closed' && 'opacity-75',
        selected && 'ring-2 ring-agent/50 shadow-lg',
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-agent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-secondary">#{payload.issueNumber}</div>
          <div className="line-clamp-2 text-sm font-medium text-primary">{payload.title}</div>
        </div>
        <Badge
          variant={payload.pipelineStatus === 'failed' ? 'danger' : 'info'}
          className="text-[10px]"
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
