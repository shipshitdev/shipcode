import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type {
  TaskGraphMode,
  TaskGraphWithNodes,
  TaskNodeRecord,
  TaskNodeStatus,
} from './lib/shipcode';
import { cn } from './lib/utils';
import { Badge } from './primitives/badge';
import { Button } from './primitives/button';

interface TaskGraphViewerProps {
  graph: TaskGraphWithNodes | null;
  className?: string;
  getIssueUrl?: (issueNumber: number) => string | null;
  onOpenIssue?: (url: string) => void;
}

const STATUS_CONFIG: Record<
  TaskNodeStatus,
  {
    label: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    badgeVariant: 'default' | 'done' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
    className: string;
  }
> = {
  ready: {
    label: 'Ready',
    icon: PlayCircle,
    badgeVariant: 'info',
    className: 'text-info',
  },
  pending: {
    label: 'Pending',
    icon: Clock,
    badgeVariant: 'default',
    className: 'text-muted',
  },
  running: {
    label: 'Running',
    icon: PlayCircle,
    badgeVariant: 'accent',
    className: 'text-accent',
  },
  completed: {
    label: 'Done',
    icon: CheckCircle2,
    badgeVariant: 'success',
    className: 'text-success',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    badgeVariant: 'danger',
    className: 'text-danger',
  },
  blocked: {
    label: 'Blocked',
    icon: AlertTriangle,
    badgeVariant: 'warning',
    className: 'text-warning',
  },
};

const modeLabel: Record<TaskGraphMode, string> = {
  direct: 'Direct',
  internal: 'Internal',
  'github-subissues': 'GitHub sub-issues',
};

function formatRisk(score: number) {
  return `${Math.round(score * 100)}%`;
}

function visibleFiles(node: TaskNodeRecord) {
  const files = node.files.slice(0, 3);
  const remaining = Math.max(0, node.files.length - files.length);
  return { files, remaining };
}

export function TaskGraphViewer({
  graph,
  className,
  getIssueUrl,
  onOpenIssue,
}: TaskGraphViewerProps) {
  if (!graph) return null;

  const orderedNodes = [...graph.nodes].sort((a, b) => a.order - b.order);
  const completedCount = orderedNodes.filter((node) => node.status === 'completed').length;
  const activeNode = orderedNodes.find((node) => node.status === 'running');
  const readyCount = orderedNodes.filter((node) => node.status === 'ready').length;

  return (
    <section className={cn('rounded-md border border-border bg-secondary p-3', className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
            Task Graph
          </h4>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="accent">{modeLabel[graph.mode]}</Badge>
            <Badge variant={graph.status === 'failed' ? 'danger' : 'default'}>{graph.status}</Badge>
            <Badge variant={graph.riskScore >= 0.65 ? 'warning' : 'default'}>
              Risk {formatRisk(graph.riskScore)}
            </Badge>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-semibold text-primary">
            {completedCount}/{orderedNodes.length}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Done</div>
        </div>
      </header>

      {graph.assessment.reasons.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {graph.assessment.reasons.slice(0, 3).map((reason) => (
            <span
              key={reason}
              className="rounded-sm border border-border bg-tertiary px-1.5 py-0.5 text-[11px] text-secondary"
            >
              {reason}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-secondary">
        <div className="rounded-sm border border-border bg-tertiary px-2 py-1.5">
          <span className="text-muted">Active</span>
          <div className="truncate font-medium text-primary">
            {activeNode ? activeNode.stableKey : 'None'}
          </div>
        </div>
        <div className="rounded-sm border border-border bg-tertiary px-2 py-1.5">
          <span className="text-muted">Ready</span>
          <div className="font-medium text-primary">{readyCount}</div>
        </div>
      </div>

      <ol className="space-y-2">
        {orderedNodes.map((node) => {
          const status = STATUS_CONFIG[node.status];
          const StatusIcon = status.icon;
          const issueUrl =
            node.githubIssueNumber !== null
              ? (getIssueUrl?.(node.githubIssueNumber) ?? null)
              : null;
          const files = visibleFiles(node);

          return (
            <li key={node.id} className="rounded-md border border-border bg-primary p-2">
              <div className="flex items-start gap-2">
                <StatusIcon size={16} className={cn('mt-0.5 shrink-0', status.className)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted">{node.stableKey}</span>
                    <span className="text-[12px] font-medium text-primary">{node.title}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant={status.badgeVariant}>{status.label}</Badge>
                    <Badge variant="default">{node.agentRole}</Badge>
                    {node.surfaces.map((surface) => (
                      <Badge key={surface} variant="default">
                        {surface}
                      </Badge>
                    ))}
                    {node.suggestedReasoningEffort !== 'none' ? (
                      <Badge variant="default">{node.suggestedReasoningEffort}</Badge>
                    ) : null}
                  </div>
                  {files.files.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {files.files.map((file) => (
                        <code
                          key={file}
                          className="max-w-full truncate rounded-sm bg-tertiary px-1.5 py-0.5 text-[11px] text-secondary"
                        >
                          {file}
                        </code>
                      ))}
                      {files.remaining > 0 ? (
                        <span className="rounded-sm bg-tertiary px-1.5 py-0.5 text-[11px] text-muted">
                          +{files.remaining}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {node.githubIssueNumber !== null ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 shrink-0 px-1.5 text-[11px] text-muted"
                    onClick={() => {
                      if (issueUrl) onOpenIssue?.(issueUrl);
                    }}
                    disabled={!issueUrl || !onOpenIssue}
                    title={`Open task issue #${node.githubIssueNumber}`}
                  >
                    #{node.githubIssueNumber}
                    <ExternalLink size={12} />
                  </Button>
                ) : (
                  <Circle size={14} className="mt-0.5 shrink-0 text-muted" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export type { TaskGraphViewerProps };
