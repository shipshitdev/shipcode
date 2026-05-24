import { ISSUE_PIPELINE_STATUS, type IssuePipelineStatus } from '@/lib/shipcode';
import type { BoardColumn, BoardSortOrder, ColumnKey } from './types';

export const COLUMNS: BoardColumn[] = [
  {
    key: 'todo',
    label: 'Todo',
    droppable: true,
    statuses: [ISSUE_PIPELINE_STATUS.todo],
  },
  {
    key: 'agent',
    label: 'Agent',
    statuses: [
      ISSUE_PIPELINE_STATUS.queued,
      ISSUE_PIPELINE_STATUS.planning,
      ISSUE_PIPELINE_STATUS.reviewing,
      ISSUE_PIPELINE_STATUS.revising,
      ISSUE_PIPELINE_STATUS.executing,
      ISSUE_PIPELINE_STATUS.testing,
      ISSUE_PIPELINE_STATUS.verifying,
      ISSUE_PIPELINE_STATUS.shipping,
    ],
    sections: [
      {
        key: 'queued',
        label: 'Queued',
        statuses: [ISSUE_PIPELINE_STATUS.queued],
        droppable: false,
      },
      {
        key: 'planning',
        label: 'Planning',
        statuses: [ISSUE_PIPELINE_STATUS.planning],
        droppable: true,
      },
      {
        key: 'reviewing',
        label: 'Reviewing',
        statuses: [ISSUE_PIPELINE_STATUS.reviewing, ISSUE_PIPELINE_STATUS.revising],
        droppable: false,
      },
      {
        key: 'waiting_execution',
        label: 'Waiting',
        statuses: [ISSUE_PIPELINE_STATUS.approval],
        droppable: false,
      },
      {
        key: 'executing',
        label: 'Executing',
        statuses: [ISSUE_PIPELINE_STATUS.executing],
        droppable: false,
      },
      {
        key: 'testing',
        label: 'Testing',
        statuses: [ISSUE_PIPELINE_STATUS.testing],
        droppable: false,
      },
      {
        key: 'verifying',
        label: 'Verifying',
        statuses: [ISSUE_PIPELINE_STATUS.verifying, ISSUE_PIPELINE_STATUS.shipping],
        droppable: false,
      },
    ],
  },
  {
    key: 'human',
    label: 'Attention',
    statuses: [
      ISSUE_PIPELINE_STATUS.clarifying,
      ISSUE_PIPELINE_STATUS.approval,
      ISSUE_PIPELINE_STATUS.paused,
      ISSUE_PIPELINE_STATUS.failed,
    ],
    sections: [
      {
        key: 'clarifying',
        label: 'Clarifying',
        statuses: [ISSUE_PIPELINE_STATUS.clarifying],
        droppable: false,
      },
      {
        key: 'approval',
        label: 'Approval',
        statuses: [ISSUE_PIPELINE_STATUS.approval],
        droppable: false,
      },
      {
        key: 'paused',
        label: 'Paused',
        statuses: [ISSUE_PIPELINE_STATUS.paused],
        droppable: false,
      },
      {
        key: 'failed',
        label: 'Failed',
        statuses: [ISSUE_PIPELINE_STATUS.failed],
        droppable: false,
      },
    ],
  },
  {
    key: 'done',
    label: 'Done',
    droppable: false,
    statuses: [ISSUE_PIPELINE_STATUS.completed, ISSUE_PIPELINE_STATUS.closed],
    sections: [
      {
        key: 'completed',
        label: 'Completed',
        statuses: [ISSUE_PIPELINE_STATUS.completed],
        droppable: false,
      },
      {
        key: 'closed',
        label: 'Closed',
        statuses: [ISSUE_PIPELINE_STATUS.closed],
        droppable: true,
      },
    ],
  },
  {
    key: 'deferred',
    label: 'Deferred',
    droppable: false,
    statuses: [ISSUE_PIPELINE_STATUS.deferred],
  },
];

export const COLUMN_DOT_CLASS: Record<ColumnKey, string> = {
  todo: 'bg-success',
  agent: 'bg-agent',
  human: 'bg-warning',
  done: 'bg-done',
  deferred: 'bg-text-muted-foreground',
};

export const COLUMN_FILL: Record<ColumnKey, number> = {
  todo: 0,
  agent: 0.5,
  human: 0.75,
  done: 1,
  deferred: 0,
};

export const COLUMN_TEXT_CLASS: Record<ColumnKey, string> = {
  todo: 'text-success',
  agent: 'text-agent',
  human: 'text-warning',
  done: 'text-done',
  deferred: 'text-muted-foreground',
};

export const COLUMN_SCROLLBAR_COLOR: Record<ColumnKey, string> = {
  todo: 'var(--success)',
  agent: 'var(--agent)',
  human: 'var(--warning)',
  done: 'var(--done)',
  deferred: 'var(--text-muted)',
};

export const DRAGGABLE_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.todo,
  ISSUE_PIPELINE_STATUS.queued,
  ISSUE_PIPELINE_STATUS.completed,
  ISSUE_PIPELINE_STATUS.failed,
  ISSUE_PIPELINE_STATUS.approval,
  ISSUE_PIPELINE_STATUS.paused,
];

export const ACTIVE_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
];

export const PHASE_ELAPSED_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
];

export const LIST_COLUMN_LABEL: Record<ColumnKey, string> = {
  todo: 'Todo',
  agent: 'Agent',
  human: 'Attention',
  done: 'Done',
  deferred: 'Deferred',
};

export const LIST_COLUMN_DROP_ID: Partial<Record<ColumnKey, string>> = {
  todo: 'todo',
  agent: 'agent:planning',
  done: 'done:closed',
};

export const BOARD_SORT_LABELS: Record<BoardSortOrder, string> = {
  priority: 'Priority',
  'id-desc': 'Newest ID',
  'id-asc': 'Oldest ID',
  title: 'Title',
};
